/** Authenticated LAN companion transport. Secrets never cross the renderer tool boundary. */
import { createServer, type Server } from 'node:https';
import { createHash, randomBytes, randomUUID, timingSafeEqual, X509Certificate } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { generate } from 'selfsigned';
import { WebSocketServer, WebSocket } from 'ws';

type Crypto = { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string };
type Stored = { key: string; cert: string; port: number; devices: Record<string, { secret: string }> };
type Peer = { socket: WebSocket; ready: boolean; permissions?: Record<string, boolean>; pending: Map<string, {resolve: (value: any) => void; timer: NodeJS.Timeout}> };
const equal = (a: unknown, b: string) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function companionAddresses() {
  return Object.entries(networkInterfaces()).flatMap(([name, entries]) => entries?.filter(entry => entry.family === 'IPv4' && !entry.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address)).map(entry => ({name,address:entry.address})) || []).sort((a,b) => Number(/virtual|docker|wsl|vpn|vethernet/i.test(a.name)) - Number(/virtual|docker|wsl|vpn|vethernet/i.test(b.name))).map(entry => entry.address).filter((address,index,all) => all.indexOf(address) === index);
}
/** Own the pinned LAN server, single-use pairing offers and serialized device requests. */
export class AndroidCompanion {
  applicationRequest?: (deviceId:string, request:Record<string,any>)=>Promise<unknown>;
  private file: string;
  private stored?: Stored;
  private storageError = false;
  private server?: Server;
  private startPromise?: Promise<void>;
  private wss?: WebSocketServer;
  private offers = new Map<string, {token:string; expiresAt:number; owner:number; paired?:boolean}>();
  private peers = new Map<string, Peer>();
  private attempts = new Map<string, {count:number; at:number}>();
  private queues = new Map<string, Promise<unknown>>();
  constructor(directory: string, private crypto: Crypto) {
    this.file=path.join(directory,'android-companion.encrypted.json');
    mkdirSync(directory,{recursive:true});
    if(existsSync(this.file)) {
      try { this.stored=JSON.parse(crypto.decryptString(Buffer.from(readFileSync(this.file,'utf8'),'base64'))); }
      catch { this.storageError=true; }
    }
  }
  /** Save TLS identity and peer credentials only through the injected encrypted storage. */
  private persist() {
    if(!this.crypto.isEncryptionAvailable()) throw new Error('System encryption unavailable');
    writeFileSync(this.file+'.tmp',this.crypto.encryptString(JSON.stringify(this.stored)).toString('base64'));
    renameSync(this.file+'.tmp',this.file);
  }
  async start() {
    if(this.storageError)throw new Error('ANDROID_COMPANION_STORAGE_UNAVAILABLE');
    if(this.server?.listening) return;
    if(this.startPromise) return this.startPromise;
    this.startPromise=this.open().finally(()=>{this.startPromise=undefined;});
    return this.startPromise;
  }
  private async open() {
    if(!this.stored) {
      const until=new Date();until.setFullYear(until.getFullYear()+2);
      const pem=await generate([{name:'commonName',value:'Codeclub Android'}],{algorithm:'sha256',keySize:2048,notAfterDate:until});
      this.stored={key:pem.private,cert:pem.cert,port:0,devices:{}};
      this.persist();
    }
    const server=createServer({key:this.stored.key,cert:this.stored.cert,minVersion:'TLSv1.2'},async(req,res)=>{
      res.setHeader('Cache-Control','no-store');
      if(req.url!=='/pair'||req.method!=='POST') {res.writeHead(404).end();return;}
      const address=req.socket.remoteAddress || 'unknown';
      for(const [key,value] of this.attempts)if(Date.now()-value.at>60000)this.attempts.delete(key);
      if(this.attempts.size>=128&&!this.attempts.has(address)) {res.writeHead(429).end();return;}
      let attempt=this.attempts.get(address);
      if(!attempt||Date.now()-attempt.at>60000) {attempt={count:0,at:Date.now()};this.attempts.set(address,attempt);}
      if(++attempt.count>8) {res.writeHead(429).end();return;}
      let length=0,body='';
      try {
        for await(const chunk of req) {length+=chunk.length;if(length>8192) throw new Error('BODY_TOO_LARGE');body+=chunk;}
        const input=JSON.parse(body),offer=this.offers.get(input.pairId);
        if(!offer||offer.paired||offer.expiresAt<=Date.now()||!equal(input.token,offer.token)||typeof input.deviceId!=='string'||!/^[-\w]{16,80}$/.test(input.deviceId)) {res.writeHead(401).end();return;}
        if(Object.keys(this.stored!.devices).length>=16&&!this.stored!.devices[input.deviceId]) {res.writeHead(409).end();return;}
        offer.paired=true;
        const secret=randomBytes(32).toString('base64url');
        const previous=this.stored!.devices[input.deviceId];
        this.stored!.devices[input.deviceId]={secret};
        try {this.persist();}catch(error){if(previous)this.stored!.devices[input.deviceId]=previous;else delete this.stored!.devices[input.deviceId];throw error;}
        this.peers.get(input.deviceId)?.socket.close(4001,'Repaired');
        res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({v:1,deviceId:input.deviceId,secret}));
      } catch {if(!res.headersSent) res.writeHead(400).end();}
    });
    server.requestTimeout=10000;server.headersTimeout=10000;server.maxConnections=32;
    const wss=new WebSocketServer({noServer:true,maxPayload:12*1024*1024});
    server.on('upgrade',(req,socket,head)=>{
      const id=String(req.headers['x-codeclub-device']||'');
      const saved=this.stored?.devices[id];
      if(req.url!=='/device'||!saved||!equal(req.headers.authorization,`Bearer ${saved.secret}`)) {socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');return;}
      wss.handleUpgrade(req,socket,head,ws=>this.attach(id,ws));
    });
    try {await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(this.stored!.port,'0.0.0.0',()=>{server.removeListener('error',reject);resolve();});});}
    catch(error) {wss.close();server.close();throw error;}
    this.server=server;this.wss=wss;this.stored.port=(server.address() as any).port;this.persist();
    server.on('error',()=>undefined);
  }
  /** Require the versioned hello before accepting either chat requests or control results. */
  private attach(id:string,socket:WebSocket) {
    this.peers.get(id)?.socket.close(4001,'Reconnected');
    const peer:Peer={socket,ready:false,pending:new Map()};this.peers.set(id,peer);
    const helloTimer=setTimeout(()=>socket.close(4002,'Handshake timeout'),10000);
    let applicationBusy=false;
    socket.on('message',data=>{
      try {
        const message=JSON.parse(data.toString());
        if(message.type==='hello'&&message.v===1) {peer.ready=true;peer.permissions={accessibility:message.permissions?.accessibility===true,paused:message.permissions?.paused===true};clearTimeout(helloTimer);return;}
        if(message.type==='app_request'&&peer.ready&&typeof message.id==='string'&&message.id.length<=80){
          if(applicationBusy||!this.applicationRequest){socket.send(JSON.stringify({type:'app_result',id:message.id,ok:false,error:'DESKTOP_BUSY'}));return;}
          applicationBusy=true;
          void this.applicationRequest(id,message.request).then(result=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'app_result',id:message.id,ok:true,result}));},()=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'app_result',id:message.id,ok:false,error:'REQUEST_REJECTED'}));}).finally(()=>{applicationBusy=false;});
          return;
        }
        const pending=peer.pending.get(message.id);
        if(message.type==='result'&&pending&&message.result&&typeof message.result==='object'&&typeof message.result.ok==='boolean') {clearTimeout(pending.timer);peer.pending.delete(message.id);pending.resolve(message.result);}
      } catch {socket.close(4002,'Invalid message');}
    });
    socket.on('error',()=>undefined);
    socket.on('close',()=>{clearTimeout(helloTimer);if(this.peers.get(id)===peer)this.peers.delete(id);for(const pending of peer.pending.values()){clearTimeout(pending.timer);pending.resolve({ok:false,error:'Android companion disconnected. Observe again; do not replay actions.'});}peer.pending.clear();});
  }
  /** Bind a short-lived QR offer to its renderer; refreshing invalidates its predecessor. */
  async offer(owner:number) {
    await this.start();
    const hosts=companionAddresses().slice(0,12);if(!hosts.length)throw new Error('NO_LAN_ADDRESS');
    this.cancelOffers(owner);
    for(const [id,offer] of this.offers)if(offer.expiresAt<Date.now())this.offers.delete(id);
    const pairId=randomUUID(),token=randomBytes(32).toString('base64url'),expiresAt=Date.now()+180000;
    this.offers.set(pairId,{token,expiresAt,owner});
    const fingerprint=new X509Certificate(this.stored!.cert).fingerprint256.replaceAll(':','').toLowerCase();
    const payload={v:1,hosts,port:this.stored!.port,pairId,token,fingerprint,expiresAt};
    return {pairId,expiresAt,hosts,code:`CC1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`};
  }
  cancelOffers(owner:number) {for(const [id,offer] of this.offers)if(offer.owner===owner)this.offers.delete(id);}
  offerPaired(id:unknown,owner:number) {const offer=typeof id==='string'?this.offers.get(id):undefined;return Boolean(offer?.owner===owner&&offer.paired);}
  status() {return Object.keys(this.stored?.devices||{}).map(id=>({deviceId:`companion:${id}`,state:this.peers.get(id)?.ready?'device':'offline',model:'Android',transport:'companion',permissions:this.peers.get(id)?.permissions}));}
  has(id:string) {return typeof id==='string'&&id.startsWith('companion:')&&Boolean(this.stored?.devices[id.slice(10)]);}
  credentialIdentity(id:string) {if(!this.has(id))throw new Error('UNKNOWN_ANDROID_DEVICE');return `${id}:${this.stored!.devices[id.slice(10)].secret}`;}
  forget(id:string) {if(!this.has(id))throw new Error('UNKNOWN_ANDROID_DEVICE');const raw=id.slice(10),saved=this.stored!.devices[raw];delete this.stored!.devices[raw];try{this.persist();}catch(error){this.stored!.devices[raw]=saved;throw error;}this.peers.get(raw)?.socket.close(4003,'Revoked');}
  /** Serialize commands per phone; cancellation cannot undo a dispatched Android gesture. */
  async run(operation:string,request:Record<string,any>,signal?:AbortSignal):Promise<any> {
    const id=String(request.deviceId).slice(10);
    if(operation==='stop') {const socket=this.peers.get(id)?.socket;if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'cancel'}));return {ok:true};}
    const previous=this.queues.get(id)||Promise.resolve();
    const work=previous.catch(()=>undefined).then(()=>new Promise<any>(resolve=>{
      const peer=this.peers.get(id);
      if(signal?.aborted||!peer?.ready||peer.socket.readyState!==WebSocket.OPEN) {resolve({ok:false,error:'Android companion is offline or cancelled.'});return;}
      const callId=randomUUID();
      const cleanup=()=>{signal?.removeEventListener('abort',cancel);peer.pending.delete(callId);};
      const cancel=()=>{cleanup();clearTimeout(timer);if(peer.socket.readyState===WebSocket.OPEN)peer.socket.send(JSON.stringify({type:'cancel',id:callId}));resolve({ok:false,dispatched:['action','lock','unlock'].includes(operation),error:'Android operation cancelled. Observe again before retrying.'});};
      const timer=setTimeout(()=>{cleanup();if(peer.socket.readyState===WebSocket.OPEN)peer.socket.send(JSON.stringify({type:'cancel',id:callId}));resolve({ok:false,dispatched:['action','lock','unlock'].includes(operation),error:'Android response timed out. Observe again; do not repeat blindly.'});},25000);
      peer.pending.set(callId,{resolve:value=>{cleanup();resolve(value);},timer});
      signal?.addEventListener('abort',cancel,{once:true});
      peer.socket.send(JSON.stringify({type:'command',id:callId,operation,request:{...request,deviceId:undefined}}));
    }));
    this.queues.set(id,work);void work.finally(()=>{if(this.queues.get(id)===work)this.queues.delete(id);});return work;
  }
  async resume() {if(this.stored)await this.start();}
  close() {this.offers.clear();for(const peer of this.peers.values())peer.socket.terminate();this.wss?.close();this.server?.close();this.server=undefined;}
}
