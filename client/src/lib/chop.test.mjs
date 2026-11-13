// node src/lib/chop.test.mjs — checks the 预留印鉴 a name is printed as.
import assert from 'node:assert/strict';
const { nameChop } = await import('./chop.ts');
assert.deepEqual(nameChop('王五'), { text: '王五之印', size: '' });
assert.deepEqual(nameChop('张小明'), { text: '张小明印', size: '' });
assert.deepEqual(nameChop('欧阳娜娜'), { text: '欧阳娜娜', size: '' });
assert.deepEqual(nameChop('阿依古丽娜'), { text: '阿依古丽娜印', size: 'is-six' });
assert.deepEqual(nameChop('司马相如文君'), { text: '司马相如文君', size: 'is-six' });
// Three columns of three are always full: nine characters.
assert.deepEqual(nameChop('买买提明艾力江'), { text: '买买提明艾力江之印', size: 'is-nine' });
assert.deepEqual(nameChop('阿卜杜热合曼江尔'), { text: '阿卜杜热合曼江尔印', size: 'is-nine' });
assert.deepEqual(nameChop('阿卜杜热合曼江尔木'), { text: '阿卜杜热合曼江尔木', size: 'is-nine' });
assert.deepEqual(nameChop('阿卜杜热合曼江尔木兰'), { text: '阿卜杜热合曼江尔木', size: 'is-nine' });
for (const name of ['买买提明艾力江', '阿卜杜热合曼江尔', '阿卜杜热合曼江尔木兰']) assert.equal(Array.from(nameChop(name).text).length, 9);
// The dot in a name is not printed, whichever dot was typed.
assert.deepEqual(nameChop('阿依·买买提'), { text: '阿依买买提印', size: 'is-six' });
assert.deepEqual(nameChop('古丽•娜'), { text: '古丽娜印', size: '' });
console.log('chop ok');
