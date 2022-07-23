import {FilePickerPlus3dThumbnails} from "./FilePickerPlus3dThumbnails.js";

Hooks.on("ready", async () => {
	if (!game.user.isGM) return;

	try {
		await FilePickerPlus3dThumbnails.pInit();
	} catch (e) {
		console.log(e);
	}
});
