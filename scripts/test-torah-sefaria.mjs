import assert from 'node:assert'
import {
  autocompleteRefs,
  getManuscripts,
  getText,
  getTorahSourceImageUrl,
  resolveTorahSource,
  validateRef,
} from '../src/torah-social/sefaria/api.ts'

console.log('Testing Torah Sefaria API integrations...')

async function runTests() {
  // 1. Test Autocomplete
  console.log('1. Testing autocompleteRefs("ברכות")...')
  const completions = await autocompleteRefs('ברכות')
  assert(completions.length > 0, 'Autocomplete should return results for ברכות')
  console.log(`   ✓ Received ${completions.length} suggestions (First: ${completions[0].title})`)

  // 2. Test Validate Ref
  console.log('2. Testing validateRef("Genesis 1:1")...')
  const valid = await validateRef('Genesis 1:1')
  assert.strictEqual(valid.ref, 'Genesis 1:1', 'Ref should be Genesis 1:1')
  console.log(`   ✓ Validated: ref="${valid.ref}", heRef="${valid.heRef}"`)

  // 3. Test Texts API (bilingual)
  console.log('3. Testing getText("Genesis 1:1")...')
  const text = await getText('Genesis 1:1')
  assert(text.versions && text.versions.length >= 1, 'Versions should be returned')
  const languages = text.versions.map(v => v.language)
  console.log(`   ✓ Received ${text.versions.length} versions. Languages: ${languages.join(', ')}`)

  // 4. Test Image URL generator
  console.log('4. Testing getTorahSourceImageUrl("Genesis 1:1")...')
  const imgUrl = getTorahSourceImageUrl('Genesis 1:1', {lang: 'he', platform: 'twitter'})
  assert(imgUrl.includes('/api/img-gen/Genesis_1%3A1') || imgUrl.includes('/api/img-gen/Genesis'), 'Image URL should target img-gen')
  console.log(`   ✓ Generated image URL: ${imgUrl}`)

  // 5. Test Live Image HTTP status
  console.log('5. Testing live image endpoint HTTP response...')
  const imgRes = await fetch(imgUrl, {method: 'HEAD'})
  assert.strictEqual(imgRes.status, 200, 'Image generator should return HTTP 200')
  const contentType = imgRes.headers.get('content-type')
  assert(contentType?.includes('image/png'), 'Content-type should be image/png')
  console.log(`   ✓ Live image verified: HTTP 200, Content-Type: ${contentType}`)

  // 6. Test Manuscripts API
  console.log('6. Testing getManuscripts("Genesis 1:1")...')
  const manuscripts = await getManuscripts('Genesis 1:1')
  assert(manuscripts.length > 0, 'Should find at least 1 manuscript for Genesis 1:1')
  console.log(`   ✓ Found ${manuscripts.length} manuscript(s): "${manuscripts[0].manuscript?.title || manuscripts[0].manuscript_slug}"`)
  console.log(`     Image URL: ${manuscripts[0].image_url}`)

  // 7. Test resolveTorahSource
  console.log('7. Testing resolveTorahSource("ברכות ב ע״א")...')
  const source = await resolveTorahSource('ברכות ב ע״א')
  assert(source.ref, 'Source should have ref')
  assert(source.imageUrl, 'Source should have imageUrl')
  console.log(`   ✓ Resolved source: "${source.heRef}" (${source.ref})`)
  console.log(`     Image: ${source.imageUrl}`)
  console.log(`     Preview: ${source.preview?.slice(0, 50)}...`)

  console.log('\n ALL TORAH SEFARIA INTEGRATION TESTS PASSED SUCCESSFULLY!')
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err)
  process.exit(1)
})
