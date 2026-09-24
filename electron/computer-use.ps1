$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Windows.Forms,System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DesktopInput {
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int GetWindowStyle(IntPtr hwnd, int index);
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public Union data; }
  [StructLayout(LayoutKind.Explicit)] public struct Union {
    [FieldOffset(0)] public Mouse mouse;
    [FieldOffset(0)] public Keyboard keyboard;
  }
  [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int dx,dy; public uint mouseData,flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Keyboard { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, Input[] inputs, int size);
  static void Send(Input input) { if (SendInput(1,new[]{input},Marshal.SizeOf(typeof(Input)))!=1) throw new Exception("Windows rejected input (integrity level or desktop unavailable)."); }
  public static void MouseEvent(uint flags, int amount) { var i=new Input(); i.type=0; i.data.mouse.flags=flags; i.data.mouse.mouseData=unchecked((uint)amount); Send(i); }
  public static void TypeText(string text) {
    foreach(char c in text) {
      var i=new Input(); i.type=1; i.data.keyboard.scan=c; i.data.keyboard.flags=4; Send(i);
      i.data.keyboard.flags=6; Send(i);
    }
  }
}
'@
[DesktopInput]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null

function Window-Element($request) {
  $desktop = [System.Windows.Automation.AutomationElement]::RootElement
  if ($request.windowId) {
    $win = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]([long]$request.windowId))
    if (-not $win -or $win.Current.NativeWindowHandle -eq 0) { throw 'Window not found. Refresh computerListWindows.' }
    return $win
  }
  if ($request.targetName -or $request.automationId) {
    $matches = @($desktop.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition) | Where-Object {
      ($request.targetName -and $_.Current.Name.IndexOf([string]$request.targetName,[StringComparison]::OrdinalIgnoreCase) -ge 0) -or
      ($request.automationId -and $_.Current.AutomationId -eq $request.automationId)
    })
    if ($matches.Count -ne 1) { throw 'Window missing or ambiguous. Use windowId from computerListWindows.' }
    return $matches[0]
  }
  $handle = [DesktopInput]::GetForegroundWindow()
  if ($handle -eq [IntPtr]::Zero) { throw 'No foreground window.' }
  return [System.Windows.Automation.AutomationElement]::FromHandle($handle)
}

function Is-Protected($element) {
  $current=$element
  for ($i=0; $current -and $i -lt 32; $i++) {
    $c=$current.Current
    if ($c.IsPassword) { return $true }
    # Legacy WinForms providers sometimes expose password edits as plain Panes.
    if ($c.NativeWindowHandle -and $c.ClassName -match 'EDIT' -and ([DesktopInput]::GetWindowStyle([IntPtr]$c.NativeWindowHandle,-16) -band 0x20)) { return $true }
    if ($c.ControlType.ProgrammaticName -eq 'ControlType.Window') { break }
    $current=[System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($current)
  }
  return $false
}

function Describe-Element($element, $parentId = '') {
  $c = $element.Current
  $r = $c.BoundingRectangle
  $patterns = @($element.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName.Replace('PatternIdentifiers.Pattern','') })
  $protected=Is-Protected $element
  $value = $null; $text = $null; $toggle = $null; $selected = $null; $expanded = $null; $readOnly=$null
  if (-not $protected) {
    if ($patterns -contains 'Value') { $vp=$element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $readOnly=$vp.Current.IsReadOnly; $value = ([string]$vp.Current.Value); if ($value.Length -gt 2000) { $value = $value.Substring(0,2000) } }
    if ($patterns -contains 'Text') { $text = $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern).DocumentRange.GetText(4000) }
  }
  if ($patterns -contains 'Toggle') { $toggle = [string]$element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState }
  if ($patterns -contains 'SelectionItem') { $selected = $element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected }
  if ($patterns -contains 'ExpandCollapse') { $expanded = [string]$element.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Current.ExpandCollapseState }
  return [pscustomobject]@{
    runtimeId=($element.GetRuntimeId() -join '.'); parentId=$parentId; name=if($protected){'[protected]'}else{$c.Name}; automationId=$c.AutomationId
    role=$c.ControlType.ProgrammaticName.Replace('ControlType.',''); className=$c.ClassName; processId=$c.ProcessId
    windowId=[string]$c.NativeWindowHandle; enabled=$c.IsEnabled; offscreen=$c.IsOffscreen; focused=$c.HasKeyboardFocus
    password=$protected; keyboardFocusable=$c.IsKeyboardFocusable; patterns=$patterns; value=$value; text=$text
    toggle=$toggle; selected=$selected; expanded=$expanded; readOnly=$readOnly
    bounds=@{x=[int]$r.X;y=[int]$r.Y;width=[int]$r.Width;height=[int]$r.Height}
  }
}

function Read-State($request) {
  $win = Window-Element $request
  $items = [Collections.Generic.List[object]]::new()
  $queue = [Collections.Generic.Queue[object]]::new()
  $queue.Enqueue(@($win,'',0))
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $visited=0; $skipped=0; $offset=[int]$request.offset; $limit=250
  $watch=[Diagnostics.Stopwatch]::StartNew()
  while ($queue.Count -gt 0 -and $visited -lt 1500 -and $watch.ElapsedMilliseconds -lt 7000) {
    $entry=$queue.Dequeue(); $el=$entry[0]; $parent=$entry[1]; $depth=$entry[2]; $visited++
    try {
      $desc=Describe-Element $el $parent
      if (-not $desc.offscreen -and ((-not $request.query) -or ($desc.name + ' ' + $desc.role + ' ' + $desc.automationId).IndexOf([string]$request.query,[StringComparison]::OrdinalIgnoreCase) -ge 0)) {
        if ($skipped -lt $offset) { $skipped++ } elseif ($items.Count -lt $limit) { $items.Add($desc) } else { break }
      }
      if ($depth -lt 15 -and -not $desc.password) {
        $child=$walker.GetFirstChild($el); $siblings=0
        while ($child -and $siblings -lt 500 -and $queue.Count -lt 1500 -and $watch.ElapsedMilliseconds -lt 7000) {
          $queue.Enqueue(@($child,$desc.runtimeId,($depth+1))); $child=$walker.GetNextSibling($child); $siblings++
        }
      }
    } catch { continue }
  }
  $focused=$null
  try { $f=[System.Windows.Automation.AutomationElement]::FocusedElement; if ($f -and $f.Current.ProcessId -eq $win.Current.ProcessId) { $focused=Describe-Element $f } } catch {}
  return @{ok=$true;window=(Describe-Element $win);focused=$focused;elements=@($items.ToArray());truncated=($queue.Count -gt 0 -or $items.Count -eq $limit);nextOffset=($offset+$items.Count);coordinateSpace='physical-screen-pixels'}
}

function Find-ObservedElement($win, $target) {
  if (-not $target) { return $null }
  if (($win.GetRuntimeId() -join '.') -eq $target.runtimeId) { $found=$win } else {
    $found=$null
    $walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker
    $queue=[Collections.Generic.Queue[object]]::new(); $queue.Enqueue($win); $count=0
    while ($queue.Count -gt 0 -and $count -lt 3000 -and -not $found) {
      $el=$queue.Dequeue(); $count++
      if (($el.GetRuntimeId() -join '.') -eq $target.runtimeId) { $found=$el; break }
      $child=$walker.GetFirstChild($el); $siblings=0
      while ($child -and $siblings -lt 500 -and $queue.Count -lt 3000) { $queue.Enqueue($child); $child=$walker.GetNextSibling($child); $siblings++ }
    }
  }
  if (-not $found) { throw 'Stale element: refresh computerGetState.' }
  $c=$found.Current
  if ($c.ClassName -ne $target.className -or $c.AutomationId -ne $target.automationId -or $c.ProcessId -ne $target.processId -or $c.Name -ne $target.name) { throw 'Element identity changed: refresh computerGetState.' }
  if (-not $c.IsEnabled -or $c.IsOffscreen) { throw 'Element disabled or offscreen.' }
  if (Is-Protected $found) { throw 'Protected input requires user interaction.' }
  return $found
}

function Assert-Foreground($win) {
  if ([DesktopInput]::GetForegroundWindow() -ne [IntPtr]$win.Current.NativeWindowHandle) { throw 'Focus changed. Focus the intended window, observe it, then retry.' }
}

function Capture-Window($request) {
  $win=Window-Element $request
  Assert-Foreground $win
  $r=$win.Current.BoundingRectangle
  $virtual=[System.Windows.Forms.SystemInformation]::VirtualScreen
  $rect=[Drawing.Rectangle]::FromLTRB([Math]::Max($virtual.Left,[int]$r.Left),[Math]::Max($virtual.Top,[int]$r.Top),[Math]::Min($virtual.Right,[int]$r.Right),[Math]::Min($virtual.Bottom,[int]$r.Bottom))
  if ($request.region) {
    $roi=[Drawing.Rectangle]::new([int]$request.region.x,[int]$request.region.y,[int]$request.region.width,[int]$request.region.height)
    $rect=[Drawing.Rectangle]::Intersect($rect,$roi)
  }
  if ($rect.Width -le 0 -or $rect.Height -le 0 -or ([long]$rect.Width*$rect.Height) -gt 20000000) { throw 'Invalid or oversized capture region.' }
  $bmp=[Drawing.Bitmap]::new($rect.Width,$rect.Height); $g=[Drawing.Graphics]::FromImage($bmp); $stream=[IO.MemoryStream]::new()
  try {
    $g.CopyFromScreen($rect.Location,[Drawing.Point]::Empty,$rect.Size)
    foreach ($mask in $request.masks) { $g.FillRectangle([Drawing.Brushes]::Black,([int]$mask.x-$rect.X),([int]$mask.y-$rect.Y),[int]$mask.width,[int]$mask.height) }
    $bmp.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
    $data=[Convert]::ToBase64String($stream.ToArray()); $ocrData=$null; $scale=1
    if ($request.scale -eq 2 -and ([long]$rect.Width*$rect.Height) -le 5000000) {
      $scale=2; $large=[Drawing.Bitmap]::new(($rect.Width*2),($rect.Height*2)); $lg=[Drawing.Graphics]::FromImage($large); $ls=[IO.MemoryStream]::new()
      try {
        $lg.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $lg.DrawImage($bmp,0,0,$large.Width,$large.Height); $large.Save($ls,[Drawing.Imaging.ImageFormat]::Png); $ocrData=[Convert]::ToBase64String($ls.ToArray())
      } finally { $lg.Dispose(); $large.Dispose(); $ls.Dispose() }
    }
    return @{ok=$true;data=$data;ocrData=$ocrData;scale=$scale;mimeType='image/png';width=$rect.Width;height=$rect.Height;origin=@{x=$rect.X;y=$rect.Y};windowId=[string]$win.Current.NativeWindowHandle;coordinateSpace='physical-screen-pixels'}
  } finally { $g.Dispose(); $bmp.Dispose(); $stream.Dispose() }
}

function Perform-Action($request) {
  $win=Window-Element $request
  if ($request.processId -and $win.Current.ProcessId -ne $request.processId) { throw 'Window identity changed.' }
  $action=[string]$request.action
  if ($action -eq 'focus' -and -not $request.target) {
    [DesktopInput]::SetForegroundWindow([IntPtr]$win.Current.NativeWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 100; Assert-Foreground $win
    return @{ok=$true;method='foreground';verified=$true}
  }
  Assert-Foreground $win
  $el=Find-ObservedElement $win $request.target
  $method='input'; $verified=$false
  if ($el) {
    $pattern=$null
    switch ($action) {
      'click' {
        if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) { $pattern.Invoke(); return @{ok=$true;method='InvokePattern';verified=$false} }
        if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$pattern)) { $pattern.Select(); return @{ok=$true;method='SelectionItemPattern';verified=$pattern.Current.IsSelected} }
      }
      'setValue' {
        if (-not $el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern) -or $pattern.Current.IsReadOnly) { throw 'Value is read-only or unsupported. Use focus and type only for an observed editable element.' }
        $pattern.SetValue([string]$request.text); return @{ok=$true;method='ValuePattern';verified=($pattern.Current.Value -ceq [string]$request.text)}
      }
      'toggle' { $pattern=$el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern); $before=$pattern.Current.ToggleState; $pattern.Toggle(); return @{ok=$true;method='TogglePattern';verified=($before -ne $pattern.Current.ToggleState)} }
      'select' { $pattern=$el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern); $pattern.Select(); return @{ok=$true;method='SelectionItemPattern';verified=$pattern.Current.IsSelected} }
      'expand' { $pattern=$el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern); $pattern.Expand(); return @{ok=$true;method='ExpandCollapsePattern';verified=([string]$pattern.Current.ExpandCollapseState -eq 'Expanded')} }
      'collapse' { $pattern=$el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern); $pattern.Collapse(); return @{ok=$true;method='ExpandCollapsePattern';verified=([string]$pattern.Current.ExpandCollapseState -eq 'Collapsed')} }
      'scroll' {
        if ($el.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern,[ref]$pattern)) {
          $before=$pattern.Current.VerticalScrollPercent
          $direction=[System.Windows.Automation.ScrollAmount]::SmallIncrement
          if ($request.amount -gt 0) { $direction=[System.Windows.Automation.ScrollAmount]::SmallDecrement }
          for ($i=0; $i -lt [Math]::Ceiling([Math]::Abs($request.amount)/120); $i++) { $pattern.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount,$direction) }
          return @{ok=$true;method='ScrollPattern';verified=($before -ne $pattern.Current.VerticalScrollPercent)}
        }
      }
      'focus' { $el.SetFocus(); return @{ok=$true;method='SetFocus';verified=$el.Current.HasKeyboardFocus} }
    }
  }
  if ($action -in @('setValue','toggle','select','expand','collapse')) { throw 'This action requires an accessible element reference.' }
  if ($action -in @('click','doubleClick','rightClick','move','scroll')) {
    $x=$request.x; $y=$request.y
    if ($el) {
      $point=[System.Windows.Point]::new()
      if (-not $el.TryGetClickablePoint([ref]$point)) { throw 'No clickable point. Refresh state or use a semantic action.' }
      $x=[int]$point.X; $y=[int]$point.Y
    }
    if ($null -eq $x -or $null -eq $y) { throw 'Missing observed coordinates.' }
    $r=$win.Current.BoundingRectangle
    if ($x -lt $r.Left -or $x -ge $r.Right -or $y -lt $r.Top -or $y -ge $r.Bottom) { throw 'Point is outside the observed window.' }
    $p=[DesktopInput+Point]::new(); $p.x=[int]$x; $p.y=[int]$y
    $hit=[DesktopInput]::GetAncestor([DesktopInput]::WindowFromPoint($p),2)
    if ($hit -ne [IntPtr]$win.Current.NativeWindowHandle) { throw 'Another window covers the target.' }
    if (-not [DesktopInput]::SetCursorPos([int]$x,[int]$y)) { throw 'Could not position cursor.' }
    if ($action -eq 'scroll') { [DesktopInput]::MouseEvent(0x0800,[int]$request.amount) }
    elseif ($action -ne 'move') {
      $down=2; $up=4; if ($action -eq 'rightClick') { $down=8; $up=16 }
      [DesktopInput]::MouseEvent($down,0); [DesktopInput]::MouseEvent($up,0)
      if ($action -eq 'doubleClick') { Start-Sleep -Milliseconds 70; [DesktopInput]::MouseEvent($down,0); [DesktopInput]::MouseEvent($up,0) }
    }
  } elseif ($action -in @('type','key')) {
    if ($el) { $el.SetFocus() }
    $focused=[System.Windows.Automation.AutomationElement]::FocusedElement
    if (-not $focused -or $focused.Current.ProcessId -ne $win.Current.ProcessId -or (Is-Protected $focused)) { throw 'No valid focused input.' }
    if ($el -and ($focused.GetRuntimeId() -join '.') -ne ($el.GetRuntimeId() -join '.')) { throw 'Could not focus the target element.' }
    if (-not $el -and ($focused.GetRuntimeId() -join '.') -ne $request.focusedId) { throw 'Input focus changed since observation.' }
    Assert-Foreground $win
    if ($action -eq 'type') { [DesktopInput]::TypeText([string]$request.text) } else { [System.Windows.Forms.SendKeys]::SendWait([string]$request.key) }
  } else { throw 'Unsupported action.' }
  return @{ok=$true;method=$method;verified=$verified}
}

while ($null -ne ($line=[Console]::ReadLine())) {
  $packet=$null
  try {
    $packet=$line | ConvertFrom-Json
    $request=$packet.request
    $result=switch ($packet.command) {
      'state' { Read-State $request }
      'capture' { Capture-Window $request }
      'action' { Perform-Action $request }
      'windows' {
        $desktop=[System.Windows.Automation.AutomationElement]::RootElement
        $windows=@($desktop.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { try { if (-not $_.Current.IsOffscreen -and $_.Current.NativeWindowHandle) { Describe-Element $_ } } catch {} })
        @{ok=$true;windows=$windows}
      }
      default { throw 'Unknown computer command.' }
    }
    @{id=$packet.id;result=$result} | ConvertTo-Json -Compress -Depth 15 | ForEach-Object { [Console]::WriteLine($_) }
  } catch { @{id=$packet.id;result=@{ok=$false;error=$_.Exception.Message}} | ConvertTo-Json -Compress -Depth 4 | ForEach-Object { [Console]::WriteLine($_) } }
}
