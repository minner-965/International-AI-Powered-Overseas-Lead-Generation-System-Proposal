// 申请试用 / Apply for a trial (public page, migration 082): POST /api/merchant-applications.
// SIM reviews the application on 商家管理 and opens the account; nothing is created automatically.
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bi = (zh, en) => `<span class="bi"><span lang="zh-CN">${esc(zh)}</span><span lang="en">${esc(en)}</span></span>`;

/** Form values → request body (empty optional fields are left out). */
export function applicationBody(form) {
  const value = name => String(form[name]?.value ?? '').trim();
  const body = { company_name: value('company_name'), contact_name: value('contact_name'), email: value('email') };
  for (const name of ['phone', 'country', 'referrer', 'message']) if (value(name)) body[name] = value(name);
  if (value('website_url2')) body.website_url2 = value('website_url2');
  return body;
}
/** First problem in the form, checked before sending; null when it can be sent. */
export function applicationProblem(body) {
  if (!body.company_name) return ['company_name', '请填写公司名称', 'Enter the company name'];
  if (!body.contact_name) return ['contact_name', '请填写联系人', 'Enter the contact person'];
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(body.email || '')) return ['email', '请填写正确的邮箱', 'Enter a valid email'];
  if (body.phone && !/^[+\d][\d\s().-]{2,39}$/.test(body.phone)) return ['phone', '电话格式不对，只填数字、空格、+ - ( )', 'Phone: digits, spaces and + - ( ) only'];
  return null;
}
/** Server refusal → message. */
export function applicationErrorText(status, code) {
  if (status === 429) return ['提交次数过多，请一小时后再试。', 'Too many applications. Try again in an hour.'];
  if (status === 403) return ['请从本页面提交申请。', 'Please send the application from this page.'];
  if (code === 'APPLICATION_EMAIL_INVALID') return ['请填写正确的邮箱', 'Enter a valid email'];
  if (code === 'APPLICATION_PHONE_INVALID') return ['电话格式不对', 'Phone number is not valid'];
  if (status === 422) return ['填写的信息有误，请检查', 'Some details are invalid'];
  if (status === 0) return ['网络连接失败，请检查网络后重试。', 'Network error. Check your connection and retry.'];
  return ['提交未完成，请重试。', 'Could not send. Please retry.'];
}

function mount() {
  const form = $('#apply-form');
  if (!form) return;
  const error = $('#apply-error'), submit = $('#apply-submit');
  const show = ([zh, en]) => { error.innerHTML = bi(zh, en); error.hidden = false; };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.hidden = true;
    const body = applicationBody(form);
    const problem = applicationProblem(body);
    if (problem) { show(problem.slice(1)); form[problem[0]]?.focus(); return; }
    submit.disabled = true;
    try {
      const response = await fetch('/api/merchant-applications', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
      if (!response.ok) { const data = await response.json().catch(() => ({})); show(applicationErrorText(response.status, data.code)); submit.disabled = false; return; }
      form.hidden = true; $('#apply-done').hidden = false; $('#apply-done-title').focus();
    } catch { show(applicationErrorText(0)); submit.disabled = false; }
  });
}
if (typeof document !== 'undefined') mount();
