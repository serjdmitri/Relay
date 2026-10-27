const test = require('node:test');
const assert = require('node:assert/strict');
const { calc } = require('../src/main/calc');
const { parseQuick, runQuick } = require('../src/main/quick');

const r = (t) => calc(t)?.reply ?? null;

test('arithmetic, said or typed', () => {
  assert.equal(r('what is 2+2*3'), '8');
  assert.equal(r('twelve times seven'), '84');
  assert.equal(r('(3 + 4) * 2'), '14');
  assert.equal(r('100 divided by 8'), '12.5');
  assert.equal(r('2 to the power of 10'), '1,024');
  assert.equal(r('square root of 144'), '12');
  assert.equal(r('what is 7 squared'), '49');
  assert.equal(r('ten plus twenty five'), '35');
  assert.equal(r('1,000 plus 2,500'), '3,500');
  assert.equal(r('20 minus 5 minus 3'), '12', 'left to right');
  assert.equal(r('2 times 3 plus 4'), '10', 'precedence');
  assert.match(r('10 / 0'), /divides by zero/);
});

test('percent and tip', () => {
  assert.equal(r('what is 15 percent of 80'), '15% of 80 is 12.');
  assert.equal(r('20% of 50'), '20% of 50 is 10.');
  assert.equal(r('what percent of 80 is 20'), '20 is 25% of 80.');
  assert.equal(r('20 percent tip on 64'), 'Tip at 20% on $64 is $12.80, so $76.80 in all.');
  assert.equal(r('tip on 45 at 18 percent'), 'Tip at 18% on $45 is $8.10, so $53.10 in all.');
});

test('unit conversions, including temperature and singular units', () => {
  assert.equal(r('convert 5 miles to kilometers'), '5 miles is 8.047 kilometers.');
  assert.equal(r('72 fahrenheit in celsius'), '72 degrees Fahrenheit is 22.222 degrees Celsius.');
  assert.equal(r('how many feet in 2 meters'), '2 meters is 6.562 feet.');
  assert.equal(r('a mile in feet'), '1 mile is 5,280 feet.');
  assert.equal(r('how many ounces in a pound'), '1 pound is 16 ounces.');
  assert.equal(r('1.5 gb in mb'), '1.5 gigabytes is 1,500 megabytes.');
  assert.equal(r('2 cups in milliliters'), '2 cups is 473.176 milliliters.');
  assert.match(r('5 miles in celsius'), /measure different things/);
});

test('things that are not maths are left alone', () => {
  for (const t of ['open 3 apps', 'what time is it', 'set a timer for 5 minutes', 'call mom at 5', 'remind me to call 5 people', 'hello there', '7 plus', '3-4-2026', 'play the next song', 'open notes']) assert.equal(calc(t), null, t);
});

test('quick commands answer maths with no model and no side effects', async () => {
  const cmd = parseQuick('what is 15 percent of 80');
  assert.equal(cmd.type, 'calc');
  const res = await runQuick(cmd, {});
  assert.equal(res.reply, '15% of 80 is 12.');
  assert.equal(res.readonly, true);
  assert.equal(parseQuick('set a timer for 5 minutes').type, 'timer', 'timers still win');
  assert.equal(parseQuick('open Notes').type, 'open-app');
  assert.equal(parseQuick('remind me to buy 2 apples').type, 'reminder');
});
