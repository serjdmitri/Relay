const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDriveCommand, parseDiskutilInfo, driveKind, bytesText, scanVolume, describeDrive } = require('../src/main/driveInspect');

test('the phrases for looking at a drive', () => {
  const P = parseDriveCommand;
  assert.deepEqual(P("what's on my SD card"), { type: 'drive-inspect', want: 'SD card', name: '' });
  assert.deepEqual(P('what is on the usb drive'), { type: 'drive-inspect', want: 'USB flash drive', name: '' });
  assert.deepEqual(P('what is on my ssd'), { type: 'drive-inspect', want: 'SSD', name: '' });
  assert.deepEqual(P('look inside my hard drive'), { type: 'drive-inspect', want: 'hard drive', name: '' });
  assert.deepEqual(P('how full is my SD card'), { type: 'drive-inspect', want: 'SD card', name: '' });
  assert.deepEqual(P('scan the external drive called ROBOT'), { type: 'drive-inspect', want: null, name: 'robot' });
  assert.deepEqual(P("what's taking up space on my drive"), { type: 'drive-inspect', want: null, name: '' });
  assert.deepEqual(P('what drives are connected'), { type: 'drives' });
  assert.deepEqual(P('check my sd card'), { type: 'drive-inspect', want: 'SD card', name: '' });
  for (const t of ['open drive', 'check my card', 'open google drive', "what's on my screen", "what's on my credit card", 'open notes', 'check my email', 'what is on my calendar', 'scan this document']) assert.equal(P(t), null, t);
});

const SD = `   Device Identifier:         disk4s1
   Device Node:               /dev/disk4s1
   Volume Name:               ROBOTCAM
   Mounted:                   Yes
   File System Personality:   ExFAT
   Protocol:                  Secure Digital
   Device / Media Name:       SD Card Reader
   Device Location:           External
   Removable Media:           Removable
   Solid State:               Info not available
   Disk Size:                 63.8 GB (63820000000 Bytes) (exactly 124648437 512-Byte-Units)
   Volume Free Space:         47.2 GB (47200000000 Bytes) (exactly 92187500 512-Byte-Units)`;
const SSD = `   Volume Name:               Backup
   File System Personality:   APFS
   Protocol:                  USB
   Device / Media Name:       Portable SSD T7
   Device Location:           External
   Removable Media:           Fixed
   Solid State:               Yes
   Volume Total Space:        1.0 TB (1000000000000 Bytes)
   Volume Free Space:         400.0 GB (400000000000 Bytes)`;

test('diskutil facts become a drive kind, and the Mac not saying is not guessed', () => {
  const sd = parseDiskutilInfo(SD);
  assert.deepEqual([sd.name, sd.fs, sd.total, sd.free, sd.used, sd.external], ['ROBOTCAM', 'ExFAT', 63820000000, 47200000000, 16620000000, true]);
  assert.equal(driveKind(sd), 'SD card');
  assert.equal(driveKind(parseDiskutilInfo(SSD)), 'SSD');
  assert.equal(driveKind({ solid: false, protocol: 'SATA', media: '', name: '' }), 'hard drive');
  assert.equal(driveKind({ solid: null, protocol: 'USB', removable: true, media: 'Mass Storage', name: '', fs: 'NTFS' }), 'USB drive', 'it does not say SSD or hard drive when the Mac does not know');
  assert.equal(driveKind({ solid: true, protocol: 'USB', removable: true, total: 32e9, fs: 'MS-DOS FAT32', media: '', name: '' }), 'USB flash drive');
  assert.equal(bytesText(63820000000), '63.8 GB');
  assert.equal(bytesText(1000000000000), '1 TB');
});

// A pretend card: DCIM with photos and a video, a logs folder, a hidden system folder and a symlink that must not be followed.
function fakeFs(tree) {
  const sizes = {};
  const node = (p) => p.split('/').filter(Boolean).reduce((n, k) => n?.[k], tree);
  const ent = (name, v, link) => ({ name, isDirectory: () => typeof v === 'object' && !link, isSymbolicLink: () => !!link });
  return {
    readdirSync: (dir) => { const n = node(dir); if (!n || typeof n !== 'object') throw new Error('EACCES'); return Object.entries(n).map(([k, v]) => ent(k, v, k === 'loop')); },
    lstatSync: (p) => ({ size: node(p) })
  };
}

test('looking inside counts by kind, finds the biggest folders, skips system folders and symlinks, and stops early on a limit', async () => {
  const tree = { DCIM: { '100': { 'a.JPG': 5e6, 'b.JPG': 6e6, 'c.mp4': 800e6 } }, logs: { 'match1.wpilog': 2e6, 'x.dslog': 1e6 }, 'notes.txt': 1000, '.Spotlight-V100': { big: 9e9 }, loop: { z: 1 } };
  const scan = await scanVolume('/Volumes/ROBOTCAM', { fsImpl: fakeFs({ Volumes: { ROBOTCAM: tree } }) });
  assert.equal(scan.files, 6);
  assert.deepEqual([scan.groups.photos.count, scan.groups.videos.count, scan.groups['robot logs'].count], [2, 1, 2]);
  assert.equal(scan.bytes, 5e6 + 6e6 + 800e6 + 3e6 + 1000);
  assert.equal(scan.biggest[0].bytes, 800e6);
  const d = describeDrive({ name: 'ROBOTCAM', path: '/Volumes/ROBOTCAM', info: parseDiskutilInfo(SD), scan });
  assert.match(d.reply, /^ROBOTCAM: SD card, ExFAT, 63.8 GB\. 16.6 GB used, 47.2 GB free \(26% full\)\./);
  assert.match(d.reply, /6 files/);
  assert.match(d.reply, /camera card/);
  assert.match(d.reply, /robot log files/);
  assert.match(d.reply, /Biggest folders: DCIM \(811 MB\)/);
  assert.doesNotMatch(d.reply, /partial/);
  assert.equal(d.items[0].title, 'videos');
  let t = 0;
  const cut = await scanVolume('/Volumes/ROBOTCAM', { fsImpl: fakeFs({ Volumes: { ROBOTCAM: tree } }), maxFiles: 3 });
  assert.equal(cut.stopped, 'file limit');
  assert.match(describeDrive({ name: 'x', info: parseDiskutilInfo(SD), scan: cut }).reply, /counts are partial/);
  const slow = await scanVolume('/Volumes/ROBOTCAM', { fsImpl: fakeFs({ Volumes: { ROBOTCAM: tree } }), maxMs: 5, now: () => (t += 10) });
  assert.equal(slow.stopped, 'time limit');
  assert.match(describeDrive({ name: 'E', info: parseDiskutilInfo(SD), scan: await scanVolume('/Volumes/E', { fsImpl: fakeFs({ Volumes: { E: {} } }) }) }).reply, /no files on it/);
});
