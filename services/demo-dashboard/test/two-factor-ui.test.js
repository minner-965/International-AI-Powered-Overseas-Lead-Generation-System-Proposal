// Two-step sign-in screens: sign-in steps, the 我的 card and the merchant reset button.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {codeErrorText,codeProblem,recoveryCodesText} from '../public/ui/v4/login.js';
import {twoFactorCardError,twoFactorCardMarkup} from '../public/ui/v4/two-factor-card.js';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('code checks: six digits for the app, ten letters and digits for a recovery code',()=>{
  assert.equal(codeProblem('123456'),null);assert.equal(codeProblem(' 123 456 '),null);
  assert.match(codeProblem('12345')[0],/6 位数字/);assert.match(codeProblem('abcdef')[0],/6 位数字/);
  assert.equal(codeProblem('abcde-23456',true),null);assert.equal(codeProblem('ABCDE 23456',true),null);
  assert.match(codeProblem('abc',true)[0],/10 位/);
});

test('second-step messages tell the user what to do',()=>{
  assert.match(codeErrorText(401,'TWO_FACTOR_CODE_INVALID')[0],/手机时间/);
  assert.match(codeErrorText(401,'TWO_FACTOR_SESSION_EXPIRED')[0],/重新输入邮箱和密码/);
  assert.match(codeErrorText(429,'AUTH_RATE_LIMITED')[0],/15 分钟/);
  assert.match(twoFactorCardError(401,'AUTH_INVALID_CREDENTIALS')[0],/密码不正确/);
  const file=recoveryCodesText(['abcde-23456','fghjk-78923'],'simon@sim.example');
  assert.match(file,/simon@sim\.example/);assert.match(file,/abcde-23456\nfghjk-78923\n$/);
});

test('我的 card: off shows the setup link; on shows renew, and switching off only when not required',()=>{
  assert.equal(twoFactorCardMarkup({}),'');
  const off=twoFactorCardMarkup({two_factor:{enabled:false,required:false}});
  assert.match(off,/href="\/login\.html\?setup2fa=1&amp;next=%2F%23me"[^>]*data-tip=/);assert.match(off,/未开启/);
  const merchant=twoFactorCardMarkup({two_factor:{enabled:true,required:false,recovery_codes_left:2}});
  assert.match(merchant,/data-2fa-action="renew"[^>]*data-tip=/);assert.match(merchant,/data-2fa-action="disable"[^>]*data-tip=/);
  assert.match(merchant,/剩余恢复码 2 个，建议重新生成/);
  const admin=twoFactorCardMarkup({two_factor:{enabled:true,required:true,recovery_codes_left:10}});
  assert.doesNotMatch(admin,/data-2fa-action="disable"/);assert.match(admin,/管理员账号必须开启/);
});

test('sign-in page has the code, setup and recovery steps; the app sends the administrator to setup',async()=>{
  const html=await read('../public/login.html');
  for(const id of ['code-form','code-input','code-mode','setup-form','setup-qr','setup-secret','setup-code','recovery-form','recovery-codes','recovery-saved'])
    assert.match(html,new RegExp(`id="${id}"`),id);
  assert.match(html,/id="code-input"[^>]*inputmode="numeric"[^>]*autocomplete="one-time-code"/);
  assert.match(html,/Microsoft Authenticator、Google Authenticator 或腾讯身份验证器/);
  const session=await read('../public/ui/v4/session.js');
  assert.match(session,/TWO_FACTOR_SETUP_REQUIRED'\) \{ location\.replace\(`\$\{LOGIN_PAGE\}\?setup2fa=1&required=1/);
  assert.match(session,/user\.two_factor_setup_required && session\.authEnabled/);
  assert.match(session,/\(login\|password\|me\|2fa\)/,'a wrong code on 我的 does not sign the user out');
  const me=await read('../public/ui/v4/me.js');assert.match(me,/twoFactorCardMarkup\(user\)/);
  const admin=await read('../public/ui/v4/merchants-admin.js');
  assert.match(admin,/data-merchant-action="reset2fa"[^>]*\$\{tip\(/);assert.match(admin,/\/reset-2fa`/);
});
