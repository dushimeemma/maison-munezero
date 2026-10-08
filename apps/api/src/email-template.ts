type EmailContent = { subject:string; text:string };
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));

// Keep outbox content as text; escape it only at the HTML delivery boundary.
export function renderEmail(message:EmailContent){
 const security=['Verify your Maison Munezero email','Reset your Maison Munezero password'].includes(message.subject);
 const code=security?message.text.match(/: ([A-Za-z0-9_-]{43})(?=\s|$)/)?.[1]:undefined;
 const title=escapeHtml(message.subject);
 const paragraphs=message.text.split(/\n+/).map(line=>`<p style="margin:0 0 18px;font-size:16px;line-height:1.7;color:#414B43">${escapeHtml(code?line.replace(`: ${code}`,'.'):line)}</p>`).join('');
 const preheader=security?message.subject:message.text.slice(0,140);
 return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#F3F1E9;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F1E9"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFEFA;border:1px solid #E1E4DA;border-radius:12px">
<tr><td style="padding:32px 28px;background:#253C30;border-radius:12px 12px 0 0;text-align:center"><div style="color:#FAF8F2;font-size:20px;font-weight:bold;letter-spacing:3px">MAISON MUNEZERO</div><div style="margin-top:10px;color:#DCE4D7;font-size:10px;letter-spacing:2px">FASHION HOUSE &amp; ATELIER</div></td></tr>
<tr><td style="padding:32px 28px"><div style="color:#A35D45;font-size:11px;letter-spacing:2px;font-weight:bold;margin-bottom:18px">${security?'YOUR ACCOUNT':'A NOTE FROM THE MAISON'}</div>
<h1 style="margin:0 0 24px;font-family:Georgia,serif;font-weight:normal;font-size:28px;line-height:1.3;color:#253C30">${title}</h1>
${code?`<p style="font-size:16px;line-height:1.7;color:#414B43">${message.subject.startsWith('Verify')?'Confirm your email address to make the most of your Maison Munezero account.':'Use the code below to reset your password securely.'}</p><div style="padding:20px;margin:24px 0;background:#EAF0E5;border:1px solid #D6DFD0;border-radius:8px"><div style="font-size:11px;color:#414B43;letter-spacing:1px;margin-bottom:12px">ONE-TIME CODE</div><div style="font-family:monospace;font-size:16px;line-height:1.7;color:#253C30;word-break:break-all;overflow-wrap:anywhere">${escapeHtml(code)}</div></div>`:''}
${paragraphs}
${security?'<p style="font-size:13px;line-height:1.6;color:#647064">Keep this code private. If you did not request this email, you can ignore it.</p>':''}
<hr style="border:0;border-top:1px solid #E1E4DA;margin:28px 0"><p style="margin:0;color:#414B43;font-size:14px;line-height:1.7">With care,<br><strong>The Maison Munezero team</strong></p></td></tr>
<tr><td style="padding:20px 28px;background:#F8F7F0;border-radius:0 0 12px 12px;text-align:center;color:#647064;font-size:12px;line-height:1.7">Ready-to-wear &nbsp; / &nbsp; Bespoke &nbsp; / &nbsp; Occasion<br>Maison Munezero · Fashion with a personal point of view.<br>This is an automated update from your Maison Munezero account.</td></tr>
</table></td></tr></table></body></html>`;
}
