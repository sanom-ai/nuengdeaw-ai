'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const cwd = __dirname;
const checks = [
  ['node', ['-c', path.join(cwd, 'phasa-tawan.js')]],
  ['node', ['-c', path.join(cwd, 'server.js')]],
  ['node', ['-c', path.join(cwd, 'smoke-test.js')]],
  ['node', ['-c', path.join(cwd, 'billing-verify.js')]],
  ['node', ['-e', "const p=require('./phasa-tawan.js'); const result=p.validateFoundationSync(); if(!result.ok){console.error(JSON.stringify(result,null,2)); process.exit(1);} console.log('Foundation validation passed');"]],
  ['node', [path.join(cwd, 'smoke-test.js')]],
  ['node', [path.join(cwd, 'billing-verify.js')]],
];

for (const [command, args] of checks) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
  });
}

console.log('Production check passed');
