const _DBG = false; // (Manually toggled)

const _MODULE_NAME = "fpp-3d-thumbnails";
const _IMAGE_FORMAT = "image/webp";
const _IMAGE_QUALITY = 0.8;

class _Util {
	static async pGetCanvasBlob (cnv) {
		return new Promise(resolve => {
			cnv.toBlob((blob) => resolve(blob), _IMAGE_FORMAT, _IMAGE_QUALITY);
		});
	}

	static downloadBlob (blob, filename) {
		const a = document.createElement("a");
		a.href = window.URL.createObjectURL(blob);
		a.download = filename;
		a.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, view: window}));
		setTimeout(() => window.URL.revokeObjectURL(a.href), 100);
	}

	static pDelay (ms, resolveAs) {
		return new Promise(resolve => setTimeout(() => resolve(resolveAs), ms));
	}
}

class _ImageSaver {
	static _getPathInfo ({path}) {
		const cleanOutPath = decodeURI(path);
		const pathParts = cleanOutPath.split("/");
		const cleanOutDir = pathParts.slice(0, -1).join("/");

		return {cleanOutPath, pathParts, cleanOutDir};
	}

	static async pCreateParentDirectories ({path}) {
		const {cleanOutPath, cleanOutDir} = this._getPathInfo({path});

		let isDirExists = false;
		try {
			const existingFiles = await FilePicker.browse("data", cleanOutDir);
			if (existingFiles?.target) isDirExists = true; // If we could browse for it, it exists
		} catch (e) {
			if (!/^Directory .*? does not exist/.test(`${e}`)) throw e;
		}

		if (isDirExists) return;
		await this._pSaveImageToServerAndGetUrl_pCreateDirectories(cleanOutPath);
	}

	static async pSaveImageToServerAndGetUrl ({blob, path}) {
		const {cleanOutPath, pathParts, cleanOutDir} = this._getPathInfo({path});

		const name = pathParts.slice(-1)[0];
		let mimeType = `image/${(name.split(".").slice(-1)[0] || "").trim().toLowerCase()}`;
		// The shortened version isn't valid (see https://www.w3.org/Graphics/JPEG/)
		if (mimeType === "image/jpg") mimeType = "image/jpeg";

		const resp = await FilePicker.upload(
			"data",
			cleanOutDir,
			new File(
				[blob],
				name,
				{
					lastModified: Date.now(),
					type: mimeType,
				},
			),
		);
		if (resp?.path) return decodeURI(resp.path);

		return cleanOutPath;
	}

	static async _pSaveImageToServerAndGetUrl_pCreateDirectories (cleanOutPath) {
		const dirParts = cleanOutPath.split("/").slice(0, -1);
		if (!dirParts.length) return;
		for (let i = 0; i < dirParts.length; ++i) {
			const dirPartSlice = dirParts.slice(0, i + 1);
			try {
				await FilePicker.createDirectory("data", dirPartSlice.join("/"));
			} catch (e) {
				if (`${e}`.startsWith(`EEXIST`)) continue;
				throw e;
			}
		}
	}
}

class FilePickerPlus3dThumbnails {
	static _TIMEOUT_RENDER_MS = 5000;

	// Lifted from Filepicker+ `FilePickerPlusExtensions.three`
	static _EXTS = [
		".glb",
		".GLB",
		".gltf",
		".GLTF",
	];

	static init () {
		this._init_registerSettings();
		this._init_addRenderFilePickerHooks();
		this._init_addLoaderPatch();
	}

	static _init_registerSettings () {
		game.settings.register(
			_MODULE_NAME,
			"maxContexts",
			{
				name: "Maximum Simultaneous Rendering Contexts",
				hint: `Note that this value is internally capped as the number of "Maximum Simultaneous Portraits" in 3D Portraits. For best results, ensure your "Maximum Simultaneous Portraits" config value is set to be greater than or equal to this value.`,
				scope: "world",
				config: true,
				type: Number,
				range: {
					min: 1,
					max: 10,
					step: 1,
				},
				default: 3,
			},
		);
	}

	static _init_addRenderFilePickerHooks () {
		Hooks.on("renderFilePicker", (app, $ele, opts) => {
			this._addBtnGenerateThumbs(app, $ele, opts);
			this._replaceThumbnailImagePaths(app, $ele, opts);
		});
	}

	static _init_addLoaderPatch () {
		// region Make a promise which encapsulates the init -> loaded process
		libWrapper.register(
			_MODULE_NAME,
			"game.threeportrait.ThreePortraitPreview.prototype.init",
			function (fn, ...args) {
				this[_MODULE_NAME] = {};
				this[_MODULE_NAME].promise = new Promise(resolve => {
					this[_MODULE_NAME].resolve = resolve;
				});

				return fn(...args);
			},
			"WRAPPER",
		);

		libWrapper.register(
			_MODULE_NAME,
			"game.threeportrait.ThreePortraitPreview.prototype.addModelToScene",
			function (fn, ...args) {
				const out = fn(...args);
				if (this[_MODULE_NAME]) this[_MODULE_NAME].resolve(true);
				return out;
			},
			"WRAPPER",
		);
		// endregion
	}

	static async _pSaveThumb (path) {
		const $tooltip = $(`<div class="filepicker-plus-tooltip isthree fpp3d__wrp-tooltip">
			<div class="filepicker-plus-three">Loading...</div>
		</div>`);
		$tooltip.appendTo(document.body);

		const preview = new game.threeportrait.ThreePortraitPreview(
			null,
			$tooltip.find(".filepicker-plus-three"),
			{
				preventAutoDispose: true,
				gltf: path,
			},
		);

		try {
			const result = await Promise.race([
				preview[_MODULE_NAME].promise,
				_Util.pDelay(this._TIMEOUT_RENDER_MS, false),
			]);

			if (!result) {
				console.warn(`Failed to render scene in ${this._TIMEOUT_RENDER_MS} ms!`);
				return;
			}

			preview.renderer.render(preview.scene, preview.camera);

			const {pathOut, imgFilename} = this._getThumbnailPathInfo(path);

			const blob = await _Util.pGetCanvasBlob(preview.renderer.domElement);

			if (_DBG) _Util.downloadBlob(blob, imgFilename);

			await _ImageSaver.pSaveImageToServerAndGetUrl({
				path: pathOut,
				blob,
			});
		} finally {
			preview.destroy(0);
			$tooltip.remove();
		}
	}

	static _getThumbnailPathInfo (path) {
		const pathParts = path.split("/");
		const filename = pathParts.slice(-1)[0];
		const dir = pathParts.slice(0, -1).join("/");
		const imgFilename = `${filename}.webp`;
		const pathOut = `fpp-3d-thumbnails/${dir}/${imgFilename}`;

		return {
			imgFilename,
			pathOut,
		};
	}

	static _getValid3dPath (imgPath) {
		const extension = `.${imgPath.split(".").pop()}`;
		const isThree = this._EXTS.includes(extension);
		if (!isThree) return null;
		return imgPath;
	}

	static _addBtnGenerateThumbs (app, $ele, opts) {
		const $wrpDisplayModes = $ele.find(`.form-fields.display-modes`);

		const $wrpBtnGenerateThumbs = $(`<div class="form-fields fpp3d__wrp-btn-generate"></div>`);

		$wrpDisplayModes.after($wrpBtnGenerateThumbs);

		const $btnGenerateThumbs = $(`<button class="fpp3d__btn-generate" title="Generate 3d Model Thumbnails" type="button"><i class="fas fa-sync"></i></button>`)
			.click(async evt => {
				evt.stopPropagation();
				evt.preventDefault();

				const eles = $ele.find(`.files-list [data-path]`).get();

				const paths = eles
					.filter(ele => this._getValid3dPath(ele.dataset.path))
					.filter(Boolean)
					.map(it => it.dataset.path);

				if (!paths.length) return ui.notifications.warn(`No 3d paths found!`);

				const tStart = Date.now();

				SceneNavigation.displayProgressBar({label: "Generating...", pct: 0});

				// Squash "file saved" spam for the duration
				libWrapper.register(
					_MODULE_NAME,
					"ui.notifications.info",
					(fn, ...args) => {
						const [msg] = args;
						if (msg.includes(`.webp saved to fpp-3d-thumbnails/`)) return;
						return fn(...args);
					},
					"MIXED",
				);

				let cntSuccess = 0;
				let cntProcessed = 0;
				const numPaths = paths.length;
				try {
					const maxContexts = Math.min(
						isNaN(game.settings.get(_MODULE_NAME, "maxContexts")) ? 1 : Number(game.settings.get(_MODULE_NAME, "maxContexts")),
						isNaN(game.settings.get("three-actor-portrait", "maxContexts")) ? 1 : Number(game.settings.get("three-actor-portrait", "maxContexts")),
					);
					console.warn(`Running thumbnail generation with ${maxContexts} contexts...`);

					// Create a directory from the first path. We do this outside of the main loop as an optimisation, which
					//   relies on the fact that we generate thumbnails for 1 directory at a time, and map each directory to
					//   a matching directory in the user's data dir.
					const {pathOut} = this._getThumbnailPathInfo(paths[0]);
					await _ImageSaver.pCreateParentDirectories({path: pathOut});

					// TODO parallelize better--this easily pegs one core at 100% during model load, can we move this out to
					//   e.g. a web worker?
					const workers = [...new Array(maxContexts)]
						.map(async () => {
							while (true) {
								const path = paths.shift();
								if (!path) break;

								try {
									await this._pSaveThumb(path);
									cntSuccess++;
								} catch (e) {
									ui.notifications.error(`Failed to save 3d thumbnail for "${path}"`);
									console.error(e);
								}

								SceneNavigation.displayProgressBar({label: "Generating...", pct: Math.round((++cntProcessed / numPaths) * 100)});
							}
						});

					await Promise.allSettled(workers);
				} finally {
					SceneNavigation.displayProgressBar({label: "Generating...", pct: 100});

					app.render(true);

					libWrapper.unregister(_MODULE_NAME, "ui.notifications.info");

					ui.notifications.info(`Generated ${cntSuccess} thumbnail${cntSuccess === 1 ? "" : "s"} in ${((Date.now() - tStart) / 1000).toFixed(2)}s.`);
				}
			})
			.appendTo($wrpBtnGenerateThumbs);
	}

	static _replaceThumbnailImagePaths (app, $ele, opts) {
		const imgs = $ele.find(`.files-list [data-path] img`).get();

		imgs
			.filter(img => this._getValid3dPath(img.parentNode.dataset.path))
			.forEach(img => {
				const imgPath = img.parentNode.dataset.path;
				const {pathOut} = this._getThumbnailPathInfo(imgPath);

				// Handle (probable, didn't investigate) lazy-loading
				if (img.src) img.src = pathOut;
				else img.dataset.src = pathOut;
			});
	}
}

export {FilePickerPlus3dThumbnails};
