const util = require('util');
const fs = require('fs');
const markdown = require('markdown').markdown;
const request = require('request');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const Cloudant = require('cloudant');

const dbName = process.env.CLOUDANT_DB || 'slack-poll';

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// env vars 
if (!process.env.VERIFY_TOKEN) console.error('WARNING: missing env var VERIFY_TOKEN, will not validate requests');
if (!process.env.CLIENT_ID || !process.env.CLIENT_SECRET) console.error('WARNING: misisng env vars CLIENT_ID and CLIENT_SECRET for slack-oauth authentication');
if (!process.env.APP_ID) {}


let polls = {
	_id: 'polls'
};

function debug() {
	if (process.env.NODE_ENV !== 'development') return;
	console.log.apply(console.log, arguments);
}

function getStatsMessage(pollId) {
	let poll = polls[pollId];
	if (!poll) return 'This channel does not have an active poll.';
	let output = "Current stats:\n";
	for(let idx in poll.opts) {
		output += "  " + poll.opts[idx] + " - " + Object.keys(poll.votes[idx]).length + " vote(s).\n";
	}
	return output;
}

let icons = [':one:',':two:',':three:',':four:',':five:',':six:',':seven:',':eight:',':nine:'];
function createVoteMessage(poll) {
	let text = poll.title+'\n\n';
	for(let i=0; i<poll.opts.length; i++) {
		text += icons[i] + ' ' + poll.opts[i];
		let votes = Object.keys(poll.votes[i]).length;
		if (votes > 0) {
			text += '\t`' + votes + '`';
		}
		text += '\n';
	}
	return text;
}

function createPoll(pollId, match, res) {
	if (typeof match === 'string') {
		match = match.replace(/(\u201C|\u201D)/g, '"');
		match = match.match(/[^"\s]+|(?:"[^"]+")/g);
	}
	
	let poll = polls[pollId] = {
		title: match[0],
		opts: [],
		votes: []
	};
	
	for(let i=1; i<match.length; i++) {
		poll.opts[i-1] = match[i];
		poll.votes[i-1] = {};
	}
	
	let attachments = [{
		"callback_id": pollId,
		"text": "Click button to vote",
		"fallback": "Your slack client does not support voting",
		"actions": []
	}];
	
	let actions = attachments[0].actions;
	
	// Create vote options.
	for(let i=0; i<poll.opts.length; i++) {
		actions.push({
			"name": "vote-option",
			"text": i+1,
			"type": "button",
			"style": "primary",
			"value": i
		});
		if (i==4) {
			let attachment = {
				"callback_id": pollId,
				"fallback": "Your slack client does not support voting",
				"actions": []
			};
			attachments.push(attachment);
			actions = attachment.actions;
		}
	}
	
	actions.push({
		"name": "poll-action",
		"type": "button",
		"text": "Close",
		"style": "danger",
		"value": "close",
	});
	
	if (!process.env.SLACK_ENTERPRISE) actions[actions.length-1].confirm = {
		"title": "Close Poll?",
		"text": "Vote buttons will be removed, are you sure?",
		"ok_text": "Yes",
		"dismiss_text": "No"
	};
	
	
	// Display in channel.
	let output  = {
		"response_type": "in_channel",
		"replace_original": false,
		"text": createVoteMessage(poll),
		"attachments": attachments
	};
	
	poll.message = output;
	debug('create-poll', JSON.stringify(output));
	res.status(200).send(output);
}

app.post('/slack/command', (req, res) => {
	let payload = req.body;
	if (process.env.VERIFY_TOKEN && process.env.VERIFY_TOKEN !== payload.token) return res.status(403);
	
	let pollId = payload.team_id + ':' + payload.channel_id;
	debug('pollId', pollId);
	
	if (!payload.text) payload.text = '';
	
	if (payload.text.match(/^\s*debug\s*$/)) {
		debug(polls);
		return res.status(200).send("Sent debug contents to console");
	}
	
	if (payload.text.match(/^\s*delete\s*$/)) {
		let poll = polls[pollId];
		if (!poll) return res.status(200).send('This channel does not have an active poll.');
		delete polls[pollId];
		return res.status(200).send('Active poll deleted.');
	}
	
	// Fix Mac smart quotes.
	payload.text = payload.text.replace(/(\u201C|\u201D)/g, '"');
	
	let match = payload.text.match(/[^"\s]+|(?:"[^"]+")/g);
	if (!match) {
		return res.status(200).send(util.format('Usage:\n  %s "Would you like to play a game?"  "Chess"  "Falken\'s Maze"  "Thermonuclear War"', payload.command));
	}
	
	if (match.length < 2) return res.status(200).send('You must provide some options to vote!');
	
	if (match.length > 10) return res.status(200).send('You entered ' + (match.length-1) + ' options. I only allow 9 options at most.');
	
	// Remove double quotes.
	for(let i=0; i<match.length; i++) {
		match[i] = match[i].replace(/^"(.*)"$/, '$1');
	}
	
	if (polls[pollId]) {
		let message = {
			"text": "There is an active poll in this channel. Locate it and click its *Close* button, or click the button below to delete active poll.",
			"attachments": [{
				"callback_id": pollId,
				"fallback": "Your slack client does not support voting",
				"actions": [{
					"name": "poll-action",
					"type": "button",
					"style": "danger",
					"text": "Delete",
					"value": "delete"
				}]
			}]
		};
		
		// slack enterprise seems do not work with confirmation dialog.
		if (!process.env.SLACK_ENTERPRISE) {
			message.attachments[0].actions[0].confirm = {
				"title": "Delete Poll?",
				"text": "Vote buttons of current active poll will stop working. Are you sure?",
				"ok_text": "Yes",
				"dismiss_text": "No"
			};
		}
		return res.status(200).send(message);
	}
	
	createPoll(pollId, match, res);
	

});


app.post('/slack/action', (req, res) => {
	let payload = req.body.payload;
	if (!payload) return res.status(400);
	try {
		payload = JSON.parse(payload);
	} catch (ex) {
		return res.status(400);
	}
	if (process.env.VERIFY_TOKEN && process.env.VERIFY_TOKEN !== payload.token) return res.status(403);
	
	let poll = polls[payload.callback_id];
	if (!poll) return res.status(200).send({
		"response_type": "ephemeral",
		"replace_original": false,
		"text": 'This poll has already been closed.'
	});
	
	let action = payload.actions && payload.actions[0];
	if (!action) return res.status(200).send({
		"response_type": "ephemeral",
		"replace_original": false,
		"text": 'ERROR: Missing action field in received payload.'
	});

	if (action.name === 'poll-action') {
		if (action.value === 'close') {
			let ts = Math.round(Date.now()/1000);
			delete polls[payload.callback_id];
			payload.original_message.attachments = [{
				"text": '<!date^'+ts+'^Poll closed at {date_num} {time_secs}|sometime> by <@'+payload.user.id+'|'+payload.user.name+'>.'
			}];
			payload.original_message.text = createVoteMessage(poll);
			return res.status(200).send(payload.original_message);
		}
		if (action.value === 'delete') {
			delete polls[payload.callback_id];
			return res.status(200).send('Active poll deleted. You may now start a new poll.');
		}
	}
	
	if (action.name !== 'vote-option') return res.status(200).send(`ERROR: unknown action \`${action.name}\``);
	
	// Check if user already voted.
	for(let idx=0; idx<poll.votes.length; idx++) {
		if (poll.votes[idx][payload.user.id]) {
			
			// If user clicked on same vote option.
			if (idx === payload.actions[0].value) return res.status(200).send({
				"response_type": "ephemeral",
				"replace_original": false,
				"text": "You already voted voted for `" + poll.opts[idx] + "`"
			});
			
			// If user clicked different vote option, update.
			delete poll.votes[idx][payload.user.id];
			poll.votes[payload.actions[0].value][payload.user.id] = true;
			payload.original_message.text = createVoteMessage(poll);
			return res.status(200).send(payload.original_message);
			
		}
	}
	
	poll.votes[payload.actions[0].value][payload.user.id] = true;
	payload.original_message.text = createVoteMessage(poll);
	return res.status(200).send(payload.original_message);


});

// slack-oauth
let html;
app.get('/', (req, res) => {
	
	if (!html) {
		html = '<html lang="en"><head>';
		if (process.env.APP_ID) html += util.format('<meta name="slack-app-id" content="%s">',process.env.APP_ID);
		html += '<title>slack-poll-app</title></head><body>';
		if (process.env.CLIENT_ID) {
			html += util.format('<p><a href="https://slack.com/oauth/authorize?client_id=%s&scope=commands"><img alt="Add to Slack" height="40" width="139" src="https://platform.slack-edge.com/img/add_to_slack.png" srcset="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x" /></a></p>', process.env.CLIENT_ID);
		}
		let content = fs.readFileSync('README.md', {encoding:'utf8'});
		html += markdown.toHTML(content);
		html += '</body></html>';
	}
	
	res.status(200).send(html);
});

app.get('/slack/auth/redirect', (req, res) => {
	if (!process.env.CLIENT_ID || !process.env.CLIENT_SECRET) {
		console.error('ERROR: misisng env vars CLIENT_ID and CLIENT_SECRET for slack-oauth authentication');
		return res.status(500).send('ERROR: misisng env vars CLIENT_ID and CLIENT_SECRET for slack-oauth authentication');
	}
    var options = {
        uri: 'https://slack.com/api/oauth.access?code='
            +req.query.code+
            '&client_id='+process.env.CLIENT_ID+
            '&client_secret='+process.env.CLIENT_SECRET,
        method: 'GET'
    }
    request(options, (err, response, body) => {
		if (err) {
			console.error('slack oauth request error:', err);
			return res.send(err);
		}
		let jsonResp = JSON.parse(body);
        if (!jsonResp.ok){
            console.error(jsonResp);
            res.send("Error encountered: \n"+jsonResp).status(200).end();
        } else {
            console.log(jsonResp);
            res.send("Success!")
        }
    })
});

let listener = app.listen(process.env.PORT || 3000, () => console.log("\n slack-poll-app service listening on port %d in %s mode", listener.address().port, app.get('env')));

let savedData = null;

function ready(cloudant) {
	let db = cloudant.db.use(dbName);
	db.get('polls', (err, body) => {
		if (err) return console.error(err);
		polls = body;
		savedData = JSON.stringify(polls);
		console.log('loaded polls from cloudant.');
	});
	
	setInterval(() => {
		let data = JSON.stringify(polls);
		if (savedData == data) return;
		db.insert(polls, (err, body) => {
			if (err) return console.error(err);
			if (!body.ok) return console.error(err);
			console.log('saved polls to cloudant.', body.rev);
			polls._rev = body.rev;
			savedData = JSON.stringify(polls);
		});
	}, 30000);
}

function connected(err, cloudant) {
	if (err) return console.error(err);
	cloudant.db.get(dbName, (err, body) => {
		if (err) {
			console.error(err);
			if ( err.error == 'not_found') {
				cloudant.db.create(dbName, (err, body) => {
					if (err) return console.error(err);
					ready(cloudant);
				});
			}
		} else {
			ready(cloudant);
		}
	});
}

try {
	if (process.env.CLOUDANT_URL) cloudant = Cloudant(process.env.CLOUDANT_URL, connected);
	else if (process.env.VCAP_SERVICES) cloudant = Cloudant({ vcapServices: JSON.parse(process.env.VCAP_SERVICES) }, connected);
} catch (ex) {
	console.error(ex);
}
