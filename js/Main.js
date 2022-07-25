import {FilePickerPlus3dThumbnails} from "./FilePickerPlus3dThumbnails.js";

Hooks.on("ready", async () => {
	if (!game.user.isGM) return;

	try {
		FilePickerPlus3dThumbnails.init();
	} catch (e) {
		console.log(e);
	}
});
