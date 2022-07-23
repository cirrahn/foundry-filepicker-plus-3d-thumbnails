class FilePickerPlus3dThumbnails {
	static _DBG = false; // (Manually toggled)

	static _MODULE_NAME = "fpp-3d-thumbnails";
	static _DELTA_RENDER = 100;
	static _IMAGE_FORMAT = "image/webp";
	static _IMAGE_QUALITY = 0.8;

	// Lifted from Filepicker+ `FilePickerPlusExtensions.three`
	static _EXTS = [
		".glb",
		".GLB",
		".gltf",
		".GLTF",
	];

	static async _pGetCanvasBlob (cnv) {
		return new Promise(resolve => {
			cnv.toBlob((blob) => resolve(blob), this._IMAGE_FORMAT, this._IMAGE_QUALITY);
		});
	}

	static _downloadBlob (blob, filename) {
		const a = document.createElement("a");
		a.href = window.URL.createObjectURL(blob);
		a.download = filename;
		a.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, view: window}));
		setTimeout(() => window.URL.revokeObjectURL(a.href), 100);
	}

	static _pDelay (ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	static async _pSaveImageToServerAndGetUrl ({blob, path}) {
		const cleanOutPath = decodeURI(path);
		const pathParts = cleanOutPath.split("/");
		const cleanOutDir = pathParts.slice(0, -1).join("/");

		let existingFiles = null;
		let isDirExists = false;
		try {
			existingFiles = await FilePicker.browse("data", cleanOutDir);
			if (existingFiles?.target) isDirExists = true; // If we could browse for it, it exists
		} catch (e) {
			if (!/^Directory .*? does not exist/.test(`${e}`)) throw e;
		}

		if (!isDirExists) {
			await this._pSaveImageToServerAndGetUrl_pCreateDirectories(cleanOutPath);
		}

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
			// region FIXME Here be dragons
			// Caveman garbage which loops until the contents of the canvas change.
			// Would ideally wait, somehow, (event? loader state? render state?) for the scene to be fully rendered
			//   instead of looping/checking. Further (or really, any) investigation required.

			preview.renderer.render(preview.scene, preview.camera);
			const dataUrlInitial = preview.renderer.domElement.toDataURL(this._IMAGE_FORMAT, this._IMAGE_QUALITY);

			let i = 0;
			for (; i < 5000; i += this._DELTA_RENDER) {
				preview.renderer.render(preview.scene, preview.camera);
				const dataUrl = preview.renderer.domElement.toDataURL(this._IMAGE_FORMAT, this._IMAGE_QUALITY);
				if (dataUrl !== dataUrlInitial) {
					if (this._DBG) {
						console.info("=============== Found diff");
						console.info(dataUrlInitial);
						console.info(dataUrl);
						console.info(dataUrlInitial.length, "vs", dataUrl.length);
						console.info("============== ...........");
					}
					break;
				}
				await this._pDelay(this._DELTA_RENDER);
			}

			// Consider delaying+rendering one final time here, in case there's a junk diff from in-progress rendering?

			// endregion

			const {pathOut, imgFilename} = this._getThumbnailPathInfo(path);

			const blob = await this._pGetCanvasBlob(preview.renderer.domElement);

			if (this._DBG) this._downloadBlob(blob, imgFilename);

			await this._pSaveImageToServerAndGetUrl({
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

	static async pInit () {
		Hooks.on("renderFilePicker", (app, $ele, opts) => {
			this._addBtnGenerateThumbs(app, $ele, opts);
			this._replaceThumbnailImagePaths(app, $ele, opts);
		});
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

				SceneNavigation.displayProgressBar({label: "Generating...", pct: 0});

				// Squash "file saved" spam for the duration
				libWrapper.register(
					this._MODULE_NAME,
					"ui.notifications.info",
					(fn, ...args) => {
						const [msg] = args;
						if (msg.includes(`.webp saved to fpp-3d-thumbnails/`)) return;
						return fn(...args);
					},
					"MIXED",
				);

				try {
					// TODO parallelize this a bit? Note that we're limited by 3d portrait's max portrait count
					//   (see `WebGlContextHandler.getOldestContext`)
					for (let i = 0; i < paths.length; ++i) {
						const path = paths[i];

						try {
							await this._pSaveThumb(path);
						} catch (e) {
							ui.notifications.error(`Failed to save 3d thumbnail for "${path}"`);
							console.error(e);
						}

						SceneNavigation.displayProgressBar({label: "Generating...", pct: Math.round((i / paths.length) * 100)});
					}
				} finally {
					SceneNavigation.displayProgressBar({label: "Generating...", pct: 100});

					app.render(true);

					libWrapper.unregister(this._MODULE_NAME, "ui.notifications.info");
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
