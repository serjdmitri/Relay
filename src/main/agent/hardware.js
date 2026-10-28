// What this Mac can see of its hardware: USB devices, serial ports, and the drives that are plugged in. Read only. The exec and file system are passed in so
// the parts that read the answers (devices.js, driveInspect.js) are tested without a Mac.
const fs = require('fs');
const path = require('path');
const { defaultExec } = require('./mac');
const { parseUsb, parsePorts } = require('../devices');
const { parseDiskutilInfo, scanVolume } = require('../driveInspect');

function createHardware({ exec = defaultExec, fsImpl = fs } = {}) {
  return {
    // Newer macOS lists USB under SPUSBHostDataType, older under SPUSBDataType: try both.
    async usb() {
      for (const type of ['SPUSBDataType', 'SPUSBHostDataType']) {
        try { const list = parseUsb(await exec('system_profiler', ['-json', type], { timeout: 15000 })); if (list.length) return list; } catch { /* try the next */ }
      }
      return [];
    },

    ports() {
      try { return parsePorts(fsImpl.readdirSync('/dev')); } catch { return []; }
    },

    // Mounted volumes other than the startup disk, each with what diskutil says about it.
    async volumes() {
      let names;
      try { names = fsImpl.readdirSync('/Volumes'); } catch { return []; }
      const out = [];
      for (const name of names) {
        const mount = path.join('/Volumes', name);
        try { if (fsImpl.lstatSync(mount).isSymbolicLink()) continue; } catch { continue; }
        let info;
        try { info = parseDiskutilInfo(await exec('diskutil', ['info', mount], { timeout: 10000 })); } catch { info = parseDiskutilInfo(''); }
        out.push({ name, path: mount, info: { ...info, name: info.name || name } });
      }
      return out;
    },

    scan: (mount, opts) => scanVolume(mount, { fsImpl, ...opts })
  };
}

module.exports = { createHardware };
