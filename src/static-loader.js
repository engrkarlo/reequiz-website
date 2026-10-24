// Browser-only JSX loader for static hosts such as Acode Live Server.
// No Node.js, npm install, Vite server, or build step is required.
// React, Babel, fflate, and Lucide are loaded from public CDNs on first load.
const status = document.getElementById('boot-status');
const statusText = status?.querySelector('span');
const errorBox = document.getElementById('boot-error');
const iconNames = ['BarChart3','BookOpen','Brain','Check','ChevronLeft','ChevronRight','CircleHelp','Clock3','FileUp','FolderOpen','GraduationCap','Home','ImagePlus','Library','ListChecks','Moon','RotateCcw','Search','Settings2','Shuffle','Sparkles','Sun','Trash2','Trophy','Upload','X','Zap','Plus','Save','Download','FileText','WandSparkles','Trash','ArrowLeft','PencilLine','ClipboardPaste','Folder','Volume2','VolumeX','Pause','Play','Terminal','LayoutGrid','List'];

function showError(error) {
  console.error('[REEQUIZ static preview]', error);
  if (statusText) statusText.textContent = 'The preview could not start. Check your internet connection and the error below.';
  if (errorBox) { errorBox.hidden = false; errorBox.textContent = error?.stack || error?.message || String(error); }
}

async function boot() {
  if (!window.React || !window.ReactDOM || !window.Babel) throw new Error('A required CDN script did not load. Open the preview while connected to the internet, then refresh.');
  if (statusText) statusText.textContent = 'Loading app libraries…';
  const [fflate, lucide] = await Promise.all([
    import('https://esm.sh/fflate@0.8.2'),
    import('https://esm.sh/lucide-react@0.468.0')
  ]);
  if (statusText) statusText.textContent = 'Loading app source…';
  const response = await fetch(new URL('./main.jsx', import.meta.url), { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load src/main.jsx (' + response.status + '). Make sure Live Server is serving the repository root folder.');
  let source = await response.text();
  source = source.replace(/^import\s+.*?;\s*$/gm, '');
  if (/^\s*import\s/m.test(source)) throw new Error('The static loader found an import statement it does not know how to resolve.');
  if (statusText) statusText.textContent = 'Compiling JSX in your browser…';
  const compiled = window.Babel.transform(source, { filename: 'main.jsx', presets: [['react', { runtime: 'classic' }]] }).code;
  const hookSetup = 'const { useEffect, useMemo, useRef, useState } = React;\n';
  const dependencyNames = ['React','createRoot','flushSync','unzipSync','strFromU8','zipSync','strToU8',...iconNames];
  const dependencyValues = [window.React,window.ReactDOM.createRoot,window.ReactDOM.flushSync,fflate.unzipSync,fflate.strFromU8,fflate.zipSync,fflate.strToU8,...iconNames.map(name => {
    if (!lucide[name]) throw new Error('Lucide icon "' + name + '" was not loaded.');
    return lucide[name];
  })];
  new Function(...dependencyNames, hookSetup + compiled)(...dependencyValues);
  if (status) status.hidden = true;
}
boot().catch(showError);
