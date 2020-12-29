const url = `${window.location.protocol}//${window.location.hostname}:${window.location.port}`;
const sound = new Howl({ // eslint-disable-line
  src: [`${url}/stream`, `${url}/stream?format=mp3`],
  format: ['aac', 'mp3'],
  html5: true,
  volume: 1
});

const play = () => {
  console.log('[DEBUG] play');
  sound.play();
};

const pause = () => {
  console.log('[DEBUG] pause');
  sound.pause();
};

$('#volume').on('input', () => { // eslint-disable-line
  sound.volume($('#volume').val() / 100); // eslint-disable-line
});
$('#play').click(play); // eslint-disable-line
$('#pause').click(pause); // eslint-disable-line