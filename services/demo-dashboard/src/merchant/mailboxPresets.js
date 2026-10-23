// Common business mailbox services. Every preset uses the workspace transport contract:
// SMTP submission on 587 with STARTTLS and IMAP on 993 with TLS.
export const MAILBOX_PRESETS=Object.freeze([
  {key:'gmail',label:'Gmail / Google Workspace',smtp_host:'smtp.gmail.com',smtp_port:587,imap_host:'imap.gmail.com',imap_port:993,
    help_url:'https://support.google.com/mail/answer/7126229'},
  {key:'microsoft365',label:'Microsoft 365 / Outlook',smtp_host:'smtp.office365.com',smtp_port:587,imap_host:'outlook.office365.com',imap_port:993,
    help_url:'https://support.microsoft.com/office/pop-imap-and-smtp-settings-8361e398-8af4-4e97-b147-6c6c4ac95353'},
  {key:'zoho',label:'Zoho Mail',smtp_host:'smtp.zoho.com',smtp_port:587,imap_host:'imap.zoho.com',imap_port:993,
    help_url:'https://www.zoho.com/mail/help/zoho-smtp.html'},
  {key:'aliyun_qiye',label:'阿里企业邮箱 Alibaba Mail',smtp_host:'smtp.qiye.aliyun.com',smtp_port:587,imap_host:'imap.qiye.aliyun.com',imap_port:993,
    help_url:'https://help.aliyun.com/zh/alimail/'},
  {key:'tencent_exmail',label:'腾讯企业邮箱 Tencent Exmail',smtp_host:'smtp.exmail.qq.com',smtp_port:587,imap_host:'imap.exmail.qq.com',imap_port:993,
    help_url:'https://service.exmail.qq.com/'},
  {key:'netease_qiye',label:'网易企业邮箱 NetEase Mail',smtp_host:'smtp.qiye.163.com',smtp_port:587,imap_host:'imap.qiye.163.com',imap_port:993,
    help_url:'https://qiye.163.com/help/'},
  {key:'other',label:'其他 Other',smtp_host:'',smtp_port:587,imap_host:'',imap_port:993,help_url:null}
].map(Object.freeze));
export const presetByKey=key=>MAILBOX_PRESETS.find(item=>item.key===key)||null;
