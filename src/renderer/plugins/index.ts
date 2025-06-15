// src/renderer/plugins/index.ts

// Import source plugins to ensure they self-register
import './sources/video';
import './sources/image';
import './sources/audio';
import './sources/colour';

// Import effect plugins to ensure they self-register
import './effects/fade';

// Import transition plugins to ensure they self-register
import './transitions/crossfade';

// console.log('All plugins loaded and registered via plugins/index.ts');
