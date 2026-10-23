import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

// AES-256-GCM for merchant mailbox passwords (node:crypto, no extra dependency).
// Format: v1:<iv b64url>:<tag b64url>:<ciphertext b64url>. The 32-byte key comes from
// MERCHANT_SECRET_KEY (64 hex characters or base64) and never reaches the database.
const fail=(code,message)=>Object.assign(new Error(message),{code,status:503});

export function parseSecretKey(value){
  const raw=String(value||'').trim();
  if(!raw)return null;
  let key=null;
  if(/^[0-9a-f]{64}$/i.test(raw))key=Buffer.from(raw,'hex');
  else{try{key=Buffer.from(raw,'base64');}catch{key=null;}}
  return key&&key.length===32?key:null;
}

export function createSecretBox(secret){
  const key=parseSecretKey(secret);
  const requireKey=()=>{if(!key)throw fail('MERCHANT_SECRET_KEY_MISSING','MERCHANT_SECRET_KEY must be a 32-byte key (64 hex characters)');return key;};
  return Object.freeze({
    configured:Boolean(key),
    encrypt(plain,aad='merchant-mailbox'){
      const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',requireKey(),iv);cipher.setAAD(Buffer.from(aad));
      const body=Buffer.concat([cipher.update(String(plain),'utf8'),cipher.final()]);
      return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),body.toString('base64url')].join(':');
    },
    decrypt(token,aad='merchant-mailbox'){
      const [version,iv,tag,body]=String(token||'').split(':');
      if(version!=='v1'||!iv||!tag||body===undefined)throw fail('MERCHANT_SECRET_INVALID','Stored secret has an unknown format');
      const decipher=createDecipheriv('aes-256-gcm',requireKey(),Buffer.from(iv,'base64url'));
      decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(Buffer.from(tag,'base64url'));
      try{return Buffer.concat([decipher.update(Buffer.from(body,'base64url')),decipher.final()]).toString('utf8');}
      catch{throw fail('MERCHANT_SECRET_INVALID','Stored secret cannot be decrypted with the configured key');}
    }
  });
}
