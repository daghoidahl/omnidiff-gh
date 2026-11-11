// Chrome refuses to compile wasm in content scripts, so they send the engine their work.
import {type DiffRequest, diffWithEngine} from './engine.js';

type Message = {omnidiff?: DiffRequest; openOptions?: true};

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
	if (message.openOptions) {
		chrome.runtime.openOptionsPage().then(() => {
			sendResponse(true);
		});
		return true;
	}

	if (!message.omnidiff) {
		return false;
	}

	diffWithEngine(message.omnidiff).then(sendResponse, (error: unknown) => {
		sendResponse({error: String(error)});
	});
	return true; // The response is asynchronous
});
