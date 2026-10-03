import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
type Crypto = { isEncryptionAvailable(): boolean; encryptString(value:string):Buffer; decryptString(value:Buffer):string };
type RecordEntry = { cipher:string; origin?:string };
export const isCredentialKey = (key:string) => /^[a-z0-9][a-z0-9_.-]*_api_key$/i.test(key);
/** Windows safeStorage uses DPAPI. Plaintext is never persisted by this store. */
export class CredentialVault {
  private entries: Record<string,RecordEntry> = {};
  private file:string;
  constructor(directory:string,private crypto:Crypto) {
    this.file=path.join(directory,'credentials.encrypted.json');mkdirSync(directory,{recursive:true});
    if(existsSync(this.file))this.entries=JSON.parse(readFileSync(this.file,'utf8'));
  }
  private persist() {const temp=this.file+'.tmp';writeFileSync(temp,JSON.stringify(this.entries));renameSync(temp,this.file);}
  set(key:string,value:string,origin?:string) {
    if(!isCredentialKey(key))throw new Error('Invalid credential identifier');
    if(!this.crypto.isEncryptionAvailable())throw new Error('System credential encryption unavailable');
    if(!value.trim()){delete this.entries[key];this.persist();return;}
    this.entries[key]={cipher:this.crypto.encryptString(value.trim()).toString('base64'),origin:origin?new URL(origin).origin:this.entries[key]?.origin};this.persist();
  }
  present(key:string) {return isCredentialKey(key)&&Boolean(this.entries[key]);}
  authorization(key:string,url:string) {
    const entry=this.entries[key];if(!entry)return null;
    const target=new URL(url);
    if(!['https:','http:'].includes(target.protocol))throw new Error('Invalid credential endpoint');
    if(entry.origin&&entry.origin!==target.origin)throw new Error('Credential endpoint mismatch');
    if(!entry.origin){entry.origin=target.origin;this.persist();}
    return this.crypto.decryptString(Buffer.from(entry.cipher,'base64'));
  }
  migrate(settingsFile:string) {
    if(!existsSync(settingsFile)||!this.crypto.isEncryptionAvailable())return;
    const settings=JSON.parse(readFileSync(settingsFile,'utf8'));let changed=false;
    for(const [key,value] of Object.entries(settings))if(isCredentialKey(key)&&typeof value==='string'&&value){if(!this.present(key))this.set(key,value);delete settings[key];changed=true;}
    if(changed){const temp=settingsFile+'.credentials.tmp';writeFileSync(temp,JSON.stringify(settings));renameSync(temp,settingsFile);}
  }
}
