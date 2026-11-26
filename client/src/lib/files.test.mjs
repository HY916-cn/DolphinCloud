// node src/lib/files.test.mjs — checks the icon a file is listed with.
import assert from 'node:assert/strict';
const { fileIcon, filesIcon } = await import('./files.ts');
assert.equal(fileIcon('报告.pdf'), 'file-text');
assert.equal(fileIcon('报告.PDF'), 'file-text');
assert.equal(fileIcon('讲稿.key'), 'file-text');
assert.equal(fileIcon('名单.xlsx'), 'file-sheet');
assert.equal(fileIcon('Data.CSV'), 'file-sheet');
assert.equal(fileIcon('合影.HEIC'), 'file-image');
assert.equal(fileIcon('logo.svg'), 'file-image');
assert.equal(fileIcon('片段.m4v'), 'file-video');
assert.equal(fileIcon('录音.m4a'), 'file-audio');
assert.equal(fileIcon('资料.tar.gz'), 'file-archive');
assert.equal(fileIcon('资料.7z'), 'file-archive');
// No extension, an unknown one, or a dot at the end: a plain file.
assert.equal(fileIcon('README'), 'file');
assert.equal(fileIcon('程序.exe'), 'file');
assert.equal(fileIcon('名单.'), 'file');
assert.equal(fileIcon(''), 'file');
// Several files: their type when they all share it.
assert.equal(filesIcon(['a.pdf', 'b.DOCX']), 'file-text');
assert.equal(filesIcon(['a.pdf', 'b.png']), 'file');
assert.equal(filesIcon(['a.zip']), 'file-archive');
assert.equal(filesIcon([]), 'file');
console.log('files ok');
