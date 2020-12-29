require('dotenv').config({
  path: require('path').join(__dirname, '.env')
});
/**
 * @type {Config}
 */
const {
  guildID,
  channelID,
  userIDs
} = require('./config.js');

const express = require('express');
const helmet = require('helmet');
const djs = require('discord.js');
const {
  sleep,
  Silence,
  processAudioStream,
  Dumper,
  highWaterMark,
  copyStream
} = require('./utils.js');
const audiomixer = require('audio-mixer');
const { join } = require('path');

const app = express();
app.use(helmet());
const client = new djs.Client();

/**
 * @type {djs.VoiceConnection}
 */
let connection;

/**
 * @type {Map<string, {
 *  piped: boolean,
 *  stream: ?import('stream').Readable,
 *  input: ?audiomixer.Input
 * }>}
 */
const streams = new Map();
Object.keys(userIDs).forEach((id) => {
  streams.set(id, {
    piped: false,
    stream: null,
    input: null
  });
});

const transcoders = {};
const Mixer = new audiomixer.Mixer({
  highWaterMark,
  channels: 2,
  bitDepth: 32,
  sampleRate: 48000,
  clearInterval: 120
});
console.log(`[DEBUG] Mixer "highWaterMark": ${Mixer.readableHighWaterMark}`);

client.on('ready', async () => {
  console.log('[DEBUG] Bot ready\n');
  const guild = client.guilds.resolve(guildID);
  if (!guild) return;

  const channel = guild.channels.resolve(channelID);
  if (!channel) return;
  if (channel.type !== 'voice') throw new Error('Channel is not voice channel!');

  const voiceState = guild.voice;
  if (!voiceState || (voiceState && !voiceState.connection)) connection = await channel.join();
  else connection = voiceState.connection;

  // Play silent packets to fix not getting voice stream bug
  connection.play(new Silence(), { type: 'opus' });
  // connection.voice.setSelfMute(1);

  connection.on('speaking', (user) => {
    if (!streams.has(user.id)) return;
    const u = streams.get(user.id);
    if (u.piped) return;

    console.log(`[DEBUG] ${user.tag} is speaking. Creating receiver...`);
    u.input = Mixer.input({
      highWaterMark,
      volume: userIDs[user.id]
    });
    console.log(`[DEBUG] ${user.tag}'s mixer input "highWaterMark": ${u.input.writableHighWaterMark}`);

    const r = u.stream = connection.receiver.createStream(user, {
      mode: 'pcm',
      end: 'manual'
    });

    console.log(`[DEBUG] ${user.tag}'s receiver "highWaterMark": ${r.readableHighWaterMark}\n`);
    r.pipe(u.input);
    u.piped = true;
    streams.set(u);
  });

  console.log('[DEBUG] Waiting for 5 seconds to load receivers...');
  await sleep(5000);
  console.log('[DEBUG] Loading transcoders...');

  transcoders.aac = processAudioStream(copyStream(Mixer));
  transcoders.mp3 = processAudioStream(copyStream(Mixer), 'mp3', 'libmp3lame');
  console.log(`[DEBUG] Transcoding audio stream to "${Object.keys(transcoders).join(', ')}" format(s)`);

  // Dumper stream to prevent the transcoder stream being full/stop flowing
  // TODO fix random stutter
  // Current Approach: changing stream highWaterMark
  // Dumper is 1 << 26
  Object.values(transcoders).forEach(rs => rs.pipe(new Dumper()));
});

// Exit handler
process.on('exit', () => {
  if (connection && connection.voice && connection.voice.channel) connection.voice.channel.leave();
  process.exit(1);
});
process.on('SIGINT', () => {
  if (connection && connection.voice && connection.voice.channel) connection.voice.channel.leave();
  process.exit(1);
});
// END Exit handler

app.use((req, res, next) => {
  res.header({
    'Transfer-Encoding': 'chunked',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    'X-Pad': 'avoid browser bug'
  });
  next();
});

app.use(express.static(join(__dirname, 'public')));
app.get('/raw', (req, res) => {
  if (connection) {
    const id = req.query.id;
    if (!id) return res.status(400).send('Invalid ID');
    if (!streams.has(id)) return res.status(404).send('Unknown ID');
    res.header({
      'Content-Type': 'binary'
    });
    res.on('close', () => {
      streams.get(id).stream.unpipe(res);
      res.removeAllListeners();
    });
    return streams.get(id).stream.pipe(res);
  }
  return res.status(423).send('Not connected');
});

app.use(require('compression')());
app.get('/stream', (req, res) => {
  const format = req.query.format || 'aac';
  const stream = transcoders[format];
  if (stream) {
    try {
      res.header({
        'Content-Type': 'audio/' + format
      });

      res.on('close', () => {
        stream.unpipe(res);
        res.removeAllListeners();
      });
      return stream.pipe(res);
    } catch (e) {
      console.error(e);
    }
  }
  return res.status(423).send('Not available');
});

const PORT = process.env.PORT || 3000;
client.login(process.env.TOKEN).then(() => {
  app.listen(PORT, () => console.log(`[DEBUG] Listening on port ${PORT}`));
});