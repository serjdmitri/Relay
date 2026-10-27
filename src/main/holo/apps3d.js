// 3D printing and CAD apps that may be installed, and the file type each opens best. Only names from this list are ever opened.

const APPS = [
  { name: 'Bambu Studio', format: '3mf' }, { name: 'OrcaSlicer', format: '3mf' }, { name: 'PrusaSlicer', format: '3mf' }, { name: 'UltiMaker Cura', format: '3mf' },
  { name: 'Ultimaker Cura', format: '3mf' }, { name: 'Cura', format: '3mf' }, { name: 'Creality Print', format: '3mf' }, { name: 'Elegoo Slicer', format: '3mf' }, { name: 'Anycubic Slicer Next', format: '3mf' },
  { name: 'Autodesk Fusion', format: 'step' }, { name: 'Autodesk Fusion 360', format: 'step' }, { name: 'Fusion 360', format: 'step' }, { name: 'FreeCAD', format: 'step' }, { name: 'Blender', format: 'stl' }, { name: 'Preview', format: 'stl' }
];

// exists(path) -> bool. Returns the apps found in /Applications or ~/Applications.
function installedApps(exists, home) {
  const found = [];
  for (const a of APPS) {
    if (a.name === 'Preview') continue; // always there, not a printing app
    if (exists(`/Applications/${a.name}.app`) || exists(`${home}/Applications/${a.name}.app`)) found.push(a);
  }
  return found;
}

const known = (name) => APPS.find((a) => a.name.toLowerCase() === String(name || '').toLowerCase()) || null;

module.exports = { APPS, installedApps, known };
