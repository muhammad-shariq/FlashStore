'use strict';
/**
 * Publishing is two deliberately separate steps:
 *
 *   1. Publish  — regenerate web/ from the database. Safe, local, repeatable.
 *   2. Push     — commit and push, which is what triggers the DigitalOcean
 *                 deploy. Kept behind its own confirmed action so saving a
 *                 product can never accidentally deploy the site.
 */
const express = require('express');
const { execFile, fork } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  execFile(cmd, args, { cwd: ROOT, maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
    resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), err });
  });
});

/** The generator runs in a child process so a crash cannot take down the admin. */
const runBuild = () => new Promise((resolve) => {
  const child = fork(path.join(ROOT, 'generator', 'build.js'), [], {
    cwd: ROOT, silent: true,
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('close', (code) => resolve({ ok: code === 0, output: out.trim(), code }));
});

module.exports = (conn, app) => {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const history = conn.prepare('SELECT * FROM build_log ORDER BY id DESC LIMIT 10').all();
    const git = await run('git', ['status', '--porcelain']);
    const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    const remote = await run('git', ['remote', 'get-url', 'origin']);

    res.render('publish', {
      title: 'Publish',
      history,
      isRepo: git.ok,
      changes: git.ok ? git.stdout.split('\n').filter(Boolean) : [],
      branch: branch.ok ? branch.stdout.trim() : null,
      remote: remote.ok ? remote.stdout.trim() : null,
      output: null,
    });
  });

  router.post('/build', async (req, res) => {
    const result = await runBuild();
    app.setFlash(result.ok ? 'success' : 'error',
      result.ok
        ? 'Site regenerated into web/. Review it, then push to deploy.'
        : 'The build failed its SEO checks and web/ may be incomplete — see the log below.');

    const history = conn.prepare('SELECT * FROM build_log ORDER BY id DESC LIMIT 10').all();
    const git = await run('git', ['status', '--porcelain']);
    const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    const remote = await run('git', ['remote', 'get-url', 'origin']);

    res.render('publish', {
      title: 'Publish',
      history,
      isRepo: git.ok,
      changes: git.ok ? git.stdout.split('\n').filter(Boolean) : [],
      branch: branch.ok ? branch.stdout.trim() : null,
      remote: remote.ok ? remote.stdout.trim() : null,
      output: result.output,
    });
  });

  router.post('/push', async (req, res) => {
    if (String(req.body.confirm || '') !== 'PUSH') {
      app.setFlash('error', 'Type PUSH to confirm — this deploys the live site.');
      return res.redirect('/publish');
    }

    const status = await run('git', ['status', '--porcelain']);
    if (!status.ok) {
      app.setFlash('error', 'This folder is not a git repository yet. See the setup notes on this page.');
      return res.redirect('/publish');
    }
    if (!status.stdout.trim()) {
      app.setFlash('error', 'Nothing to push — there are no changes since the last commit.');
      return res.redirect('/publish');
    }

    const message = String(req.body.message || '').trim() || 'Update catalogue';
    const steps = [];
    for (const [cmd, args] of [
      ['git', ['add', '-A']],
      ['git', ['commit', '-m', message]],
      ['git', ['push']],
    ]) {
      const r = await run(cmd, args);
      steps.push(`$ ${cmd} ${args.join(' ')}\n${r.stdout}${r.stderr}`);
      if (!r.ok) {
        app.setFlash('error', `\`${cmd} ${args[0]}\` failed. See the log.`);
        const history = conn.prepare('SELECT * FROM build_log ORDER BY id DESC LIMIT 10').all();
        return res.render('publish', {
          title: 'Publish', history, isRepo: true,
          changes: [], branch: null, remote: null, output: steps.join('\n\n'),
        });
      }
    }
    app.setFlash('success', 'Pushed. DigitalOcean will pick up the change and deploy automatically.');
    const history = conn.prepare('SELECT * FROM build_log ORDER BY id DESC LIMIT 10').all();
    res.render('publish', {
      title: 'Publish', history, isRepo: true,
      changes: [], branch: null, remote: null, output: steps.join('\n\n'),
    });
  });

  return router;
};
