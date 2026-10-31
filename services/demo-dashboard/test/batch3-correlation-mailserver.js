// In-process mail server double for the batch 3 correlation tests (no network).
/** A mail server that rewrites Message-ID, drops X-DPV-Message-Key and files a copy in "Sent Messages". */
export function rewritingServer({rewrite=true,folderName='Sent Messages',specialUse='\\Sent'}={}){
  const sent=[];const folders={INBOX:[],[folderName]:[]};let uid=100;
  const transporterFactory=()=>({async sendMail(mail){
    const id=rewrite?`<srv-${sent.length+1}@shimin.example>`:mail.messageId;
    sent.push(mail);
    folders[folderName].push({uid:++uid,envelope:{subject:mail.subject,from:[{address:String(mail.from).match(/<([^>]+)>/)?.[1]||String(mail.from)}],to:[{address:mail.to}]},
      headers:Buffer.from(`Message-ID: ${id}\r\nDate: ${new Date().toUTCString()}\r\nSubject: x\r\n${rewrite?'':`X-DPV-Message-Key: ${mail.headers['X-DPV-Message-Key']}\r\n`}`),
      bodyStructure:{type:'text/plain',part:'1'},body:Buffer.from(`${mail.text}\r\n`)});
    return{messageId:mail.messageId};
  },async close(){}});
  const lists=[];
  const imapClientFactory=()=>{let current='INBOX';const client={mailbox:{uidValidity:7,uidNext:1},
    async connect(){},async logout(){},
    async list(){lists.push(1);return[{path:'INBOX'},{path:folderName,specialUse}];},
    async getMailboxLock(folder){current=folder;const rows=folders[folder]||[];client.mailbox={uidValidity:7,uidNext:(rows.at(-1)?.uid||0)+1};return{release(){}};},
    fetch(){const rows=folders[current]||[];return(async function*(){for(const row of rows)yield row;})();},
    async fetchOne(id){const row=(folders[current]||[]).find(item=>item.uid===id);return{bodyParts:new Map([['1',row.body]])};}};
    return client;};
  return{sent,folders,lists,transporterFactory,imapClientFactory};
}
