# Disposable WPF app for desktop-control integration tests. No user files.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FixtureWindow { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }'
[xml]$markup=@"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="Codeclub Computer Use Fixture" Width="660" Height="440" WindowStartupLocation="CenterScreen" Topmost="True">
<StackPanel Margin="20">
<TextBox x:Name="Entry" AutomationProperties.Name="Fixture input" Height="32"/>
<Button x:Name="Apply" Content="Apply fixture" Height="32" Margin="0,10,0,0"/>
<CheckBox x:Name="Toggle" Content="Fixture toggle" Margin="0,10,0,0"/>
<TextBlock x:Name="Result" Text="Waiting" Margin="0,10,0,0"/>
<PasswordBox x:Name="Secret" Height="30" Margin="0,10,0,0"/>
<Border x:Name="Canvas" Background="White" Height="100" Margin="0,10,0,0"><Image x:Name="Drawing" Stretch="None"/></Border>
</StackPanel></Window>
"@
$form=[Windows.Markup.XamlReader]::Load([Xml.XmlNodeReader]::new($markup))
$entryBox=$form.FindName('Entry'); $applyButton=$form.FindName('Apply'); $resultLabel=$form.FindName('Result')
$form.FindName('Secret').Password='never-expose-this'
$visual=[Windows.Media.DrawingVisual]::new(); $dc=$visual.RenderOpen()
$formatted=[Windows.Media.FormattedText]::new('CANVAS ACTION 42',[Globalization.CultureInfo]::InvariantCulture,[Windows.FlowDirection]::LeftToRight,[Windows.Media.Typeface]::new('Arial'),24,[Windows.Media.Brushes]::Black,1.0)
$dc.DrawText($formatted,[Windows.Point]::new(10,15)); $dc.Close()
$bitmap=[Windows.Media.Imaging.RenderTargetBitmap]::new(500,90,96,96,[Windows.Media.PixelFormats]::Pbgra32); $bitmap.Render($visual)
$form.FindName('Drawing').Source=$bitmap
$form.FindName('Canvas').Add_MouseLeftButtonDown({ $resultLabel.Text='Canvas clicked' })
$applyButton.Add_Click({ $resultLabel.Text='Applied: '+$entryBox.Text })
$form.Add_ContentRendered({ $handle=[Windows.Interop.WindowInteropHelper]::new($form).Handle; [FixtureWindow]::ShowWindow($handle,5) | Out-Null; [FixtureWindow]::SetForegroundWindow($handle) | Out-Null; $entryBox.Focus() | Out-Null; [Console]::WriteLine('READY'); [Console]::Out.Flush() })
$form.ShowDialog() | Out-Null
