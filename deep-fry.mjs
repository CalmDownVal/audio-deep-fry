import { readFile, unlink, writeFile } from 'node:fs/promises';
import { EOL } from 'node:os';
import { extname, resolve } from 'node:path';

import { Lame } from 'node-lame';
import * as Wave from 'node-wav';

const DEEP_FRY_BITRATE = [ 32, 40, 48, 56, 64 ];
const DEEP_FRY_ITERATIONS = 50;
const DEEP_FRY_BOOST = 10.0;
const DEEP_FRY_CLIP = softClip(10.0);

(async () => {
	if (process.argv.length < 4) {
		println('Usage: deep-fry <src-file[.wav|.mp3]> <dst-file[.mp3]>');
		return;
	}

	const PATH_INPUT = resolve(process.argv[2]);
	const PATH_OUTPUT = resolve(process.argv[3]);
	const PATH_TMP_MPEG = resolve('./_temp-mpeg.mp3');
	const PATH_TMP_WAVE = resolve('./_temp-wave.wav');

	try {
		let input;
		switch (extname(PATH_INPUT).toLowerCase()) {
			case '.mp3':
				println(`- decoding: ${PATH_INPUT}`);
				await decodeMpeg(PATH_INPUT, input = PATH_TMP_WAVE);
				break;

			case '.wav':
				input = PATH_INPUT;
				break;

			default:
				println(`- unsupported file type: ${extname(PATH_INPUT)}`);
				return;
		}

		await convertToMono(input, input = PATH_TMP_WAVE);

		let i = 1;
		for (; i <= DEEP_FRY_ITERATIONS; i += 1) {
			print(`\r- iteration ${i}/${DEEP_FRY_ITERATIONS}`);
			await encodeMpeg(PATH_TMP_WAVE, PATH_TMP_MPEG, choose(DEEP_FRY_BITRATE));
			await decodeMpeg(PATH_TMP_MPEG, PATH_TMP_WAVE);
			await boostWave(PATH_TMP_WAVE, PATH_TMP_WAVE, DEEP_FRY_BOOST, DEEP_FRY_CLIP);
		}

		println();
		println(`- writing: ${PATH_OUTPUT}`);
		await encodeMpeg(PATH_TMP_WAVE, PATH_OUTPUT);
	}
	catch (ex) {
		println(`- error: ${ex.message}`);
		console.error(ex);
	}
	finally {
		println('- cleaning up');
		await tryUnlink(PATH_TMP_MPEG);
		await tryUnlink(PATH_TMP_WAVE);
	}
})();


async function decodeMpeg(pathSrc, pathDst) {
	await new Lame({ output: pathDst })
		.setFile(pathSrc)
		.decode();
}

async function encodeMpeg(pathSrc, pathDst, bitrate = 192) {
	await new Lame({
		output: pathDst,
		bitrate
	})
		.setFile(pathSrc)
		.encode();
}

function boostWave(pathSrc, pathDst, gain, clip) {
	const amplitude = Math.pow(10.0, gain / 20.0);
	return processWave(pathSrc, pathDst, channels => {
		channels.forEach(channel => {
			const { length } = channel;
			let i = 0;
			for (; i < length; i += 1) {
				channel[i] = clip(channel[i] * amplitude);
			}
		});
	});
}

function convertToMono(pathSrc, pathDst) {
	return processWave(pathSrc, pathDst, channels => {
		const channelCount = channels.length;
		const sampleCount = channels[0].length;

		let i = 0;
		let j;
		let sample;

		for (; i < sampleCount; i += 1) {
			for (j = 0, sample = 0.0; j < channelCount; j += 1) {
				sample += channels[j][i];
			}

			channels[0][i] = sample / channelCount;
		}

		return [ channels[0] ];
	});
}

async function processWave(pathSrc, pathDst, block) {
	const bufferSrc = await readFile(pathSrc);
	const wave = Wave.decode(bufferSrc);
	const data = block(wave.channelData) ?? wave.channelData;
	const bufferDst = Wave.encode(data, {
		sampleRate: wave.sampleRate,
		bitDepth: 16,
		float: false,
	});

	await writeFile(pathDst, bufferDst);
}


function hardClip(slope) {
	return sample => clamp(sample * slope);
}

function softClip(slope) {
	return sample => Math.tanh(sample * slope);
}

function diode(slope) {
	const reciprocal = 1.0 / slope;
	return sample => clamp(Math.sign(sample) * Math.pow(Math.abs(sample), reciprocal));
}


async function tryUnlink(path) {
	try {
		await unlink(path);
	}
	catch (ex) {
		if (ex.code !== 'ENOENT') {
			throw ex;
		}
	}
}

function clamp(sample) {
	return Math.min(Math.max(sample, -1.0), 1.0);
}

function choose(options) {
	return options[Math.floor(Math.random() * options.length)];
}

function println(msg) {
	if (msg !== undefined) {
		print(msg);
	}

	process.stdout.write(EOL);
}

function print(msg) {
	process.stdout.write(msg);
}
