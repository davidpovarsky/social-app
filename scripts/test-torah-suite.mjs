import assert from 'node:assert';
import {
  formatHebrewRef,
  searchTorahSources,
  validateRef,
  autocompleteRefs,
} from '../src/torah-social/sefaria/api.ts';
import {
  detectTorahSources,
  detectTorahSourcesFallback,
  extractCandidateTorahRefs,
} from '../src/torah-social/sefaria/linker.ts';

async function runTests() {
  console.log('========================================');
  console.log('Torah Social — Search & Detection Suite');
  console.log('========================================\n');

  // --- 1. Sefaria Exact & Deep Ref Search Tests ---
  console.log('1. Testing searchTorahSources("ראש השנה כב")...');
  const resRosh22 = await searchTorahSources('ראש השנה כב');
  assert(resRosh22.length >= 3, 'Should return multiple candidates');
  assert.strictEqual(resRosh22[0].exact, true, 'First result must be exact');
  assert(resRosh22[0].title.includes('ראש השנה כ״ב'), 'First result should be Rosh Hashanah 22');
  const keysRosh22 = resRosh22.map(r => r.key);
  assert(keysRosh22.includes('Rosh Hashanah 22a'), 'Should include 22a candidate');
  assert(keysRosh22.includes('Rosh Hashanah 22b'), 'Should include 22b candidate');
  console.log('   ✓ ראש השנה כב: Exact daf and daf/amud candidates returned and ranked first.');

  console.log('2. Testing searchTorahSources("ראש השנה כב ע\\"ב")...');
  const resRosh22b = await searchTorahSources('ראש השנה כב ע"ב');
  assert(resRosh22b.length > 0, 'Should return results');
  assert.strictEqual(resRosh22b[0].exact, true, 'First result must be exact');
  assert.strictEqual(resRosh22b[0].key, 'Rosh Hashanah 22b', 'First result must be Rosh Hashanah 22b');
  assert(resRosh22b[0].title.includes('ע״ב'), 'Title should display ע״ב');
  console.log('   ✓ ראש השנה כב ע"ב: Exact amud is ranked #1.');

  console.log('3. Testing searchTorahSources("ברכות ב ע\\"א")...');
  const resBerakhot2a = await searchTorahSources('ברכות ב ע"א');
  assert.strictEqual(resBerakhot2a[0].exact, true, 'First result must be exact');
  assert.strictEqual(resBerakhot2a[0].key, 'Berakhot 2a', 'Must be Berakhot 2a');
  console.log('   ✓ ברכות ב ע"א: Exact resolved source is #1.');

  console.log('4. Testing searchTorahSources("ברכות ב")...');
  const resBerakhot2 = await searchTorahSources('ברכות ב');
  assert.strictEqual(resBerakhot2[0].exact, true, 'Must be exact');
  assert.strictEqual(resBerakhot2[0].key, 'Berakhot 2', 'Must be Berakhot 2');
  const keysBer2 = resBerakhot2.map(r => r.key);
  assert(keysBer2.includes('Berakhot 2a') && keysBer2.includes('Berakhot 2b'), 'Should include amud candidates');
  console.log('   ✓ ברכות ב: Resolves daf and both amudim candidates.');

  console.log('5. Testing searchTorahSources("ברכות")...');
  const resBerakhot = await searchTorahSources('ברכות');
  assert(resBerakhot.length > 0, 'Should return completions');
  assert.strictEqual(resBerakhot[0].key, 'Berakhot', 'Top result is tractate Berakhot');
  console.log('   ✓ ברכות: Autocomplete and book match work properly.');

  console.log('6. Testing searchTorahSources("Genesis 1")...');
  const resGen1 = await searchTorahSources('Genesis 1');
  assert.strictEqual(resGen1[0].exact, true, 'Genesis 1 must be exact');
  assert.strictEqual(resGen1[0].key, 'Genesis 1', 'Top result must be Genesis 1');
  console.log('   ✓ Genesis 1: Exact chapter match #1.');

  console.log('7. Testing searchTorahSources("Genesis 1:1")...');
  const resGen11 = await searchTorahSources('Genesis 1:1');
  assert.strictEqual(resGen11[0].exact, true, 'Genesis 1:1 must be exact');
  assert.strictEqual(resGen11[0].key, 'Genesis 1:1', 'Top result must be Genesis 1:1');
  console.log('   ✓ Genesis 1:1: Exact verse match #1.');

  // --- 2. Automatic Citation Detection & Robust Fallback Tests ---
  console.log('\n--- Automatic Citation Detection Tests ---');
  console.log('8. Testing candidate extraction from prose: "כמו שכתוב בראש השנה כב ע\\"א..."');
  const candidates1 = extractCandidateTorahRefs('כמו שכתוב בראש השנה כב ע"א וכולי וכולי');
  assert(candidates1.length > 0, 'Should extract candidate');
  assert.strictEqual(candidates1[0].candidate, 'ראש השנה כב ע"א');
  console.log('   ✓ Extracted candidate:', candidates1[0].candidate);

  console.log('9. Testing fallback detection for: "כמו שכתוב בראש השנה כב ע\\"א..."');
  const fallbackRes1 = await detectTorahSourcesFallback('כמו שכתוב בראש השנה כב ע"א וכולי');
  assert(fallbackRes1.length > 0, 'Fallback should detect source');
  assert(fallbackRes1[0].heRef.includes('ראש השנה'), 'Should identify Rosh Hashanah');
  assert(fallbackRes1[0].heRef.includes('ע״א'), 'Should format amud');
  console.log('   ✓ Fallback validated source:', fallbackRes1[0].heRef, `(${fallbackRes1[0].ref})`);

  console.log('10. Testing fallback detection for: "עיין ברכות ב ע\\"ב"');
  const fallbackRes2 = await detectTorahSourcesFallback('שלום לכולם עיין ברכות ב ע"ב בדברי הגמרא');
  assert(fallbackRes2.length > 0, 'Fallback should detect Berakhot 2b');
  assert.strictEqual(fallbackRes2[0].ref, 'Berakhot 2b');
  console.log('   ✓ Fallback validated source:', fallbackRes2[0].heRef);

  console.log('11. Testing fallback detection for: "בראשית א:א נאמר..."');
  const fallbackRes3 = await detectTorahSourcesFallback('בפסוק בראשית א:א נאמר בראשית ברא');
  assert(fallbackRes3.length > 0, 'Fallback should detect Genesis 1:1');
  assert.strictEqual(fallbackRes3[0].ref, 'Genesis 1:1');
  console.log('   ✓ Fallback validated source:', fallbackRes3[0].heRef);

  console.log('12. Testing non-Torah prose: "סתם טקסט של בוקר טוב מה שלומך היום"');
  const candidatesNonTorah = extractCandidateTorahRefs('סתם טקסט של בוקר טוב מה שלומך היום יום נפלא');
  assert.strictEqual(candidatesNonTorah.length, 0, 'Should not match any Torah sources');
  const fallbackNonTorah = await detectTorahSourcesFallback('סתם טקסט של בוקר טוב מה שלומך היום יום נפלא');
  assert.strictEqual(fallbackNonTorah.length, 0, 'Fallback must return 0 results');
  console.log('   ✓ Conservative filter: zero false positives on ordinary text.');

  console.log('13. Testing full detectTorahSources engine...');
  const fullDetect = await detectTorahSources('הנה בראש השנה כב ע"א מצינו יסוד גדול');
  assert(fullDetect.length > 0, 'Full engine should return detected source');
  assert(fullDetect[0].heRef.includes('ראש השנה כ״ב'), 'Ref should match Rosh Hashanah');
  console.log('   ✓ Full detection engine succeeded with:', fullDetect[0].heRef);

  console.log('\n========================================');
  console.log('ALL 13 TORAH SEARCH & DETECTION TESTS PASSED!');
  console.log('========================================\n');
}

runTests().catch(err => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
