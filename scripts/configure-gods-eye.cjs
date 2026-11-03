// After cloning the upstream repo and installing its locked dependencies, register the local runtime.
const fs=require('fs'),path=require('path'),os=require('os');
const [repoArg,nodeArg]=process.argv.slice(2);
if(!repoArg||!nodeArg)throw Error('Usage: node scripts/configure-gods-eye.cjs /path/to/gods-eye-view /path/to/node');
const repo=fs.realpathSync(repoArg),node=fs.realpathSync(nodeArg);
if(JSON.parse(fs.readFileSync(path.join(repo,'package.json'))).name!=='gods-eye-view'||!fs.existsSync(path.join(repo,'node_modules/vite/bin/vite.js')))throw Error('Install God’s Eye dependencies first.');
const dir=path.join(os.homedir(),'Library/Application Support/Relay');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,'gods-eye-runtime.json');fs.writeFileSync(file,JSON.stringify({repo,node},null,2),{mode:0o600});console.log('God’s Eye runtime registered for Relay.');
