/* -------------- External deps -------------- */
var express = require('express');
var router = express.Router();
var moment = require('moment');
var YouTube = require('youtube-node');
var Promise = require('es6-promise').Promise;
var DateTimeHelper = require('../dateTimeHelper');
var winston = require('winston');

/* -------------- Config -------------- */

//this env var must be manually set to your unique key for youtube-API  see README.md
var apiKey = process.env.YOUTUBEAPIKEY;

var startProgramme = moment(now).format("YYYY-MM-DD") + " 00:00"; //first video on the playlist will start at this time
var endProgramme = null;
var currentChannel = null;
var currentlyPlaying = null;
globalsettings = {
	shouldCache: true, //false: make new get requests to youtube every time
	printlogs: false,
	requestCounter: 0
}
/*
	Change these playlist keys!
	The keys are the strings after `pl=` in the url when watching a playlist on youtube.com
*/
var channels = {
	mixed: {
		name: "Main Channel",
		playlist: 'PLoFIHcp8yG7RAH_6ctBzVHi9DN_6nKAc4',
		aggregatedPlaylist: null,
		cachedResult: null
	},
	mtv: {
		name: "MTV",
		playlist: 'PLoFIHcp8yG7Tnv63BtXOBYMRpKVOCOipS',
		aggregatedPlaylist: null,
		cachedResult: null
	},
	scifi: {
		name: "Sci-Fi",
		playlist: 'PLoFIHcp8yG7TZCMpvoJN1sTxLXSC2fX-o',
		aggregatedPlaylist: null,
		cachedResult: null
	},
	western: {
		name: "Western",
		playlist: 'PLoFIHcp8yG7Rw81Vziam16u1U_v-tWUIl',
		aggregatedPlaylist: null,
		cachedResult: null
	},
	classics: {
		name: "old school classics",
		playlist: 'PLoFIHcp8yG7QOui_Nljd3L3ZDn-47fnkP',
		aggregatedPlaylist: null,
		cachedResult: null
	},
	horror: {
		name: "terror",
		playlist: 'PLoFIHcp8yG7R9uevgGe_oG3vWYwfPvhPc',
		aggregatedPlaylist: null,
		cachedResult: null
	},
	docs: {
		name: "Documentaries",
		playlist: 'PLoFIHcp8yG7TbDOaNjkw6UMPjzaNC-4hX',
		aggregatedPlaylist: null,
		cachedResult: null
	},
	test: {
		name: "test",
		id: 'PLoFIHcp8yG7Tnv63BtXOBYMRpKVOCOipS',
		aggregatedPlaylist: null,
		cachedResult: null
	}
}

var now = new Date();


/* -------------- Channel routes -------------- */
router.get('/western', function (req, res) {
	getAllTheThings(req, res, channels.western);
});
router.get('/scifi', function (req, res) {
	getAllTheThings(req, res, channels.scifi);
});
router.get('/classics', function (req, res) {
	getAllTheThings(req, res, channels.classics);
});
router.get('/horror', function (req, res) {
	getAllTheThings(req, res, channels.horror);
});
router.get('/mtv', function (req, res) {
	getAllTheThings(req, res, channels.mtv);
});
router.get('/docs', function (req, res) {
	getAllTheThings(req, res, channels.docs);
});
router.get('/test', function (req, res) {
	getAllTheThings(req, res, channels.test);
});

/* -------------- Default route -------------- */
router.get('/', function (req, res) {
	getAllTheThings(req, res, channels.mixed);
});

/* -------------- Setup handlers -------------- */
winston.configure({
	transports: [
		new (winston.transports.File)({ filename: 'errors.log' })
	]
});
/************** Main func ************** */
function getAllTheThings(req, res, channel) {
	currentChannel = channel;
	globalsettings.requestCounter++;
	now = new Date();
	console.info(now.getHours() + ":" + now.getMinutes(), " ~ Request", globalsettings.requestCounter, "for", channel.name);

	if (typeof apiKey === "undefined") {
		throw new Error("Damnit! process.env.YOUTUBEAPIKEY is not set");
	}
	var plData = null;
	if (globalsettings.shouldCache && channel.cachedResult) {
		var currentTime = new Date();
		var scheduleEnd = channel.cachedResult.items[channel.cachedResult.items.length - 1].endTime;
		if (scheduleEnd - currentTime <= 0) {
			
			//reset schedule
			startProgramme = currentTime;
			winston.log('info', { message: 'Shedule end time ' + scheduleEnd + '.\n New start-time: ' + startProgramme });
			console.log('info', { message: 'Shedule end time ' + scheduleEnd + '.\n New start-time: ' + startProgramme });
		}
		var previousProgrammeEndTime = moment(startProgramme).toDate();
		channel.cachedResult.items.forEach(function (item, ix) {
			item.playFirst = false;
			item = setStartTime(item, previousProgrammeEndTime);
			previousProgrammeEndTime = item.endTime;
		});
		var encodedResult = encodeURIComponent(JSON.stringify(channel.cachedResult));
		res.render('index', {
			title: 'Web TV',
			encodedJson: encodedResult
		});
		return;
	}

	//fetch
	channel.aggregatedPlaylist = null

	getPlayListAsync(channel.playlist, null, channel)
		.then(function (playListData) {
			plData = playListData;
			getVideosFromPlaylistAsync(plData)
				.then(function (videoArray) {
					var plWithEnhancedVids = getPlaylistEnhanchedWithVideos(plData, videoArray);
					endProgramme = plWithEnhancedVids.items[plWithEnhancedVids.items.length - 1].endTime;
					var encodedResult = encodeURIComponent(JSON.stringify(plWithEnhancedVids));
					if (globalsettings.shouldCache) {
						channel.cachedResult = plWithEnhancedVids;
					}
					res.render('index', {
						title: 'Web TV',
						encodedJson: encodedResult
					});
				})
				.catch(function (e) {
					console.error(e);
					winston.log("info", "--------" + currentChannel.name + "--------");
					winston.log('error: ' + e.message);
					res.render('error', {
						message: e.message,
						error: e,
						title: 'error'
					});
				})
		})
		.catch(function (e) {
			console.error(e);
			res.render('error', {
				message: e.message,
				error: e,
				title: 'error'
			});
		});
}

/* -------------- Logic -------------- */


/*
promise an array of videoDetails
*/
function getVideosFromPlaylistAsync(data) {

	var promiseArray = data.items.map((playListItem) => {
		return getVideoById(playListItem.snippet.resourceId.videoId)
	});
	var p = new Promise(function (resolve, reject) {
		Promise.all(promiseArray).then(function (videoArray) {
			resolve(videoArray);
		});
	});
	return p;
}


function setStartTime(item, previousProgrammeEndTime) {
	if (typeof previousProgrammeEndTime === "undefined") {
		previousProgrammeEndTime = moment(startProgramme).toDate();
	}

	item.startTime = previousProgrammeEndTime;
	item.startTimeFormatted = moment(item.startTime).format("HH:mm");
	item.endTime = moment(previousProgrammeEndTime).add(item.durationSeconds, "seconds").toDate();
	previousProgrammeEndTime = item.endTime;

	var diff = Math.abs(moment(item.startTime).diff(moment(item.endTime)), "seconds");
	var startDiff = moment(now).diff(item.startTime, 'seconds');
	var endDiff = moment(now).diff(item.endTime, 'seconds');

	item.past = false;
	item.playFirst = false;
	item.future = false;

	if (endDiff > 0) {
		item.past = true;
	}
	if (startDiff > 0 && endDiff < 0) {
		item.playFirst = true;
		currentlyPlaying = item;
		//console.log("Play this video first:");

		var skipMs = Math.ceil(Math.abs((now.getTime() - item.startTime.getTime())));
		var skipTo = new Date(skipMs);
		item.skipToSeconds = skipMs / 1000;
		item.skipToString = DateTimeHelper.msToYoutubeSkipString(skipMs);
	}
	//console.log(item.snippet.title, item.playFirst, item.skipTo, item.startTime, item.endTime);
	return item;
}

function removeBrokenVideos(playList, detailedVideos) {
	for (ix = playList.items.length - 1; ix--;) {
		var item = playList.items[ix];
		if (!item) {
			winston.log('error',
				'Video was undefined', { index: ix, playListId: playList.id });
			console.error("item", ix, "was undefined");
			playList.items.splice(ix, 1);
			continue;
		}
		var video = detailedVideos[ix];
		var shouldRemove = false;
		if (typeof video.items[0] === "undefined"
			|| video.items.length === 0) {
			playList.items.splice(ix, 1);
			detailedVideos.splice(ix, 1);
			console.error("index", ix, "has no video. probably deleted");
			winston.log("info", "--------" + currentChannel.name + "--------");
			winston.log('error',
				'No items for video', ix, item.title);
			continue;
		}
		if (item.status.privacyStatus !== "public"
			|| video.items[0].status.embeddable !== true) {
			shouldRemove = true;
			console.error(item.snippet.title, "is not public/embeddable");
		}
		if (typeof video.items === "undefined") {
			winston.log("info", "--------" + currentChannel.name + "--------");
			winston.log("god damn! video.items is undefined");
		}
		else if (typeof video.items[0] === "undefined") {
			winston.log("info", "--------" + currentChannel.name + "--------");
			winston.log("god damn! video.items[0] is undefined");
		}

		if (typeof video.items[0].contentDetails.regionRestriction !== "undefined"
			&& typeof video.items[0].contentDetails.regionRestriction.blocked !== "undefined"
			&& video.items[0].contentDetails.regionRestriction.blocked.indexOf("SE") > -1) {
			shouldRemove = true;
			console.error(item.snippet.title, "has regionRestriction in SE");
			winston.log("info", "--------" + currentChannel.name + "--------");
			winston.log('error',
				'Video not avaliable in Sweden' + ' ' + ix + ' ' + item.title);
		}
		if (shouldRemove) {
			playList.items.splice(ix, 1);
			detailedVideos.splice(ix, 1);
		}
	}
	return { playList: playList, detailedVideos: detailedVideos };
}

/*
Extend playlist items with metadata from video details
*/
function getPlaylistEnhanchedWithVideos(playList, detailedVideos) {
	now = new Date();
	if (detailedVideos.length !== playList.items.length)
		throw new Error(playList.items.length, "items in playlist");
	var previousProgrammeEndTime = moment(startProgramme).toDate();

	var filtered = removeBrokenVideos(playList, detailedVideos);
	playList = filtered.playList;
	playList.items = playList.items.filter((item) => { return typeof item !== "undefined"; });
	detailedVideos = filtered.detailedVideos;
	if (detailedVideos.length !== playList.items.length)
		console.error(videos.length, "videos", playList.items.length, "items in playlist");

	for (ix = 0; ix < playList.items.length; ix++) {
		var item = playList.items[ix];
		var video = detailedVideos[ix];
		if (!video.items[0]) {
			console.error("something is messed up with video", ix);
		}
		var durationString = video.items[0].contentDetails.duration;
		var hms = DateTimeHelper.getHoursMinutesSeconds(durationString);
		item.durationSeconds = hms.s * 1 + hms.m * 60 + (hms.h * 60 * 60);
		item = setStartTime(item, previousProgrammeEndTime);
		previousProgrammeEndTime = item.endTime;
	}
	//Loop the schedule by moving past stuff to the end
	previousProgrammeEndTime = playList.items[playList.items.length - 1].endTime;
	while (playList.items[0].past === true) {
		var item = setStartTime(playList.items[0], previousProgrammeEndTime);
		previousProgrammeEndTime = item.endTime;
		item.past = false;
		item.future = true;
		playList.items.push(playList.items.splice(0, 1)[0]);
	}

	return playList;
}

function getVideoById(videoId) {
	var youTube = new YouTube();
	youTube.setKey(apiKey);

	return new Promise(function (fulfill, reject) {
		youTube.getById(videoId, function (error, result) {
			if (error) {
				console.error(error);
				winston.log('error',
					'Exception', { error: error });
				reject(error);
			}
			else {
				fulfill(result);
			}
		});
	});
}

function getPlayListAsync(videoId, page, settings) {
	if (typeof page === "undefined" || page === null)
		page = null;

	var youTube = new YouTube();
	youTube.setKey(apiKey);

	return new Promise(function (fulfill, reject) {
		youTube.getPlayListsItemsById(videoId, page, function (error, result) {
			if (error) {
				console.error(error);
				winston.log("info", "--------" + currentChannel.name + "--------");

				winston.log('error',
					'Exception', { error: error });
				reject(error);
			} else {
				//aggregate
				if (settings.aggregatedPlaylist === null) {
					settings.aggregatedPlaylist = result;
				} else {
					Array.prototype.push.apply(settings.aggregatedPlaylist.items, result.items);
				}

				//return
				if (result.nextPageToken || settings.maxPageCount >= settings.pageCounter) {
					//console.log("page", settings.pageCounter, " : ", result.nextPageToken, "1st : ", result.items[0].snippet.title);
					settings.pageCounter++;
					fulfill(getPlayListAsync(videoId, result.nextPageToken, settings));
				}
				else {
					fulfill(settings.aggregatedPlaylist);
				}
			}
		});
	});
}

/* -------------- Extensions -------------- */
function debuglog(args) {
	if (globalSettings.printlogs) {
		console.log(args);
	}
}

module.exports = router;