import test from 'node:test';
import assert from 'node:assert/strict';
import {marketDonut} from '../public/ui/v3/overview.js';

test('market donut uses actual market shares with text counts and no sample countries',()=>{
  const html=marketDonut([['AE',2],['MX',1]],3);
  assert.match(html,/stroke-dasharray="66\.666/);
  assert.match(html,/阿联酋/);
  assert.match(html,/墨西哥/);
  assert.match(html,/2 · 66\.7%/);
  assert.doesNotMatch(html,/KSA|3\.4k|45%/);
});
test('market donut has empty state and truthful single-market ring',()=>{
  assert.doesNotMatch(marketDonut([],0),/<svg/);
  assert.match(marketDonut([['AE',2]],2),/stroke-dasharray="100 0"/);
  assert.match(marketDonut([['<script>',2]],2),/&lt;script&gt;/);
});
