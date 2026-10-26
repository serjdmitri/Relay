three.js r170 (MIT, see LICENSE): three.module.min.js, OrbitControls.js and STLLoader.js from the official three package.
Only change: the two "from 'three'" imports now read "from './three.module.min.js'", so no import map is needed.
