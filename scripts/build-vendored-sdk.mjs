import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=new URL('../vendor/semwright-native-sdk/src/index.ts',import.meta.url);
const out=new URL('../vendor/semwright-native-sdk/dist/',import.meta.url);
mkdirSync(out,{recursive:true});
writeFileSync(new URL('index.js',out),stripTypeScriptTypes(readFileSync(source,'utf8'),{mode:'transform',sourceMap:false}));
console.log('Transpiled unchanged canonical Native SDK source. This is not typechecking.');
