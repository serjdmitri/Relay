three.js r170 (MIT, see LICENSE): three.module.min.js, STLLoader.js, GLTFLoader.js, GLTFExporter.js and BufferGeometryUtils.js from the official three package.
Only change: the imports of 'three' and of the utils now point at the files next to them ("./three.module.min.js", "./BufferGeometryUtils.js"), so no import map is needed.
