import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash, randomBytes } from 'node:crypto';
import {
  sha256,
  hmacSha256,
  hmacHex,
  hmacBase64Url,
  toHex,
  fromHex,
  toBase64Url,
  fromBase64Url,
  utf8,
  fromUtf8,
  timingSafeEqual,
  randomId,
} from '../dist/index.js';

const hex = (bytes) => Buffer.from(bytes).toString('hex');

// ------------------------------------------------ متّجهات FIPS 180-4 الرسمية
test('بصمات SHA-256 تطابق متّجهات FIPS المنشورة', () => {
  const vectors = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    [
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
    ],
  ];
  for (const [input, expected] of vectors) {
    assert.equal(hex(sha256(utf8(input))), expected, `فشل المتّجه: "${input.slice(0, 20)}"`);
  }
});

test('مليون حرف a — المتّجه الطويل', () => {
  assert.equal(
    hex(sha256(utf8('a'.repeat(1000000)))),
    'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
  );
});

// ------------------------------------------- مطابقة node:crypto بايتًا ببايت
test('SHA-256 يطابق node:crypto على كل طول حول حدّ الكتلة', () => {
  // الأحجام 0..200 تغطّي الحشو القصير والطويل وحافة الـ55/56 بايت التي
  // تُسقط أغلب التطبيقات الخاطئة.
  for (let length = 0; length <= 200; length++) {
    const input = randomBytes(length);
    assert.equal(
      hex(sha256(new Uint8Array(input))),
      createHash('sha256').update(input).digest('hex'),
      `اختلاف عند طول ${length}`,
    );
  }
});

test('SHA-256 يطابق node:crypto على مدخلات عشوائية كبيرة', () => {
  for (let i = 0; i < 100; i++) {
    const input = randomBytes(1 + Math.floor(Math.random() * 5000));
    assert.equal(hex(sha256(new Uint8Array(input))), createHash('sha256').update(input).digest('hex'));
  }
});

test('HMAC يطابق node:crypto بمفاتيح أقصر وأطول من الكتلة', () => {
  // المفتاح الأطول من 64 بايت يُختصر ببصمته — فرع كامل لا يُختبر بالمفاتيح القصيرة.
  for (const keyLength of [0, 1, 16, 63, 64, 65, 100, 200]) {
    for (let i = 0; i < 12; i++) {
      const key = randomBytes(keyLength);
      const message = randomBytes(Math.floor(Math.random() * 500));
      assert.equal(
        hex(hmacSha256(new Uint8Array(key), new Uint8Array(message))),
        createHmac('sha256', key).update(message).digest('hex'),
        `اختلاف عند مفتاح بطول ${keyLength}`,
      );
    }
  }
});

test('hmacHex و hmacBase64Url يطابقان صيغتي node:crypto', () => {
  for (let i = 0; i < 50; i++) {
    const key = randomBytes(24).toString('hex');
    const message = randomBytes(40).toString('base64');
    assert.equal(hmacHex(key, message), createHmac('sha256', key).update(message).digest('hex'));
    assert.equal(
      hmacBase64Url(key, message),
      createHmac('sha256', key).update(message).digest('base64url'),
    );
  }
});

test('HMAC متداخل — مسار تيليجرام نفسه', () => {
  // secret = HMAC("WebAppData", token) ثم hash = HMAC(secret, data)
  const token = '1234567:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
  const data = 'auth_date=1700000000\nuser={"id":1}';
  const mine = toHex(hmacSha256(hmacSha256(utf8('WebAppData'), utf8(token)), utf8(data)));
  const theirs = createHmac('sha256', createHmac('sha256', 'WebAppData').update(token).digest())
    .update(data)
    .digest('hex');
  assert.equal(mine, theirs);
});

// ------------------------------------------------------------- التحويلات
test('hex و base64url يعودان بالقيمة نفسها', () => {
  for (let i = 0; i < 100; i++) {
    const bytes = new Uint8Array(randomBytes(1 + Math.floor(Math.random() * 100)));
    assert.deepEqual(fromHex(toHex(bytes)), bytes);
    assert.deepEqual(fromBase64Url(toBase64Url(bytes)), bytes);
    assert.equal(toBase64Url(bytes), Buffer.from(bytes).toString('base64url'));
  }
});

test('صيغ خاطئة تُرفض بلا استثناء', () => {
  assert.equal(fromHex('abc'), null, 'طول فردي');
  assert.equal(fromHex('zz'), null, 'حروف خارج النطاق');
  assert.deepEqual(fromHex(''), new Uint8Array(0));
});

test('النص العربي يعبر ذهابًا وإيابًا', () => {
  const value = 'رقعة — لعبة سيطرة 🇮🇶';
  assert.equal(fromUtf8(utf8(value)), value);
  assert.equal(hmacHex('س', value), createHmac('sha256', 'س').update(value).digest('hex'));
});

// ----------------------------------------------------------- مقارنة ومعرّف
test('المقارنة الثابتة تميّز الاختلاف في أي موضع', () => {
  const base = new Uint8Array(32).fill(7);
  assert.equal(timingSafeEqual(base, new Uint8Array(32).fill(7)), true);
  for (const position of [0, 15, 31]) {
    const other = new Uint8Array(32).fill(7);
    other[position] ^= 1;
    assert.equal(timingSafeEqual(base, other), false, `فات الاختلاف عند ${position}`);
  }
  assert.equal(timingSafeEqual(base, new Uint8Array(31).fill(7)), false, 'طول مختلف');
});

test('المعرّفات العشوائية لا تتكرّر', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(randomId());
  assert.equal(seen.size, 1000);
});
