#target photoshop
// 虚募阁 · UI 批导出 PNG（ExtendScript）
// 变量 XU_WORKSPACE_ROOT、XU_ASSET_LIST 由生成器注入

(function () {
  var workspaceRoot = "{{XU_WORKSPACE_ROOT}}";
  var assetList = {{XU_ASSET_LIST}};
  var exportDir = new Folder(workspaceRoot + "/UI/export");
  if (!exportDir.exists) exportDir.create();

  var opts = new ExportOptionsSaveForWeb();
  opts.format = SaveDocumentType.PNG;
  opts.PNG8 = false;
  opts.interlaced = false;
  opts.transparency = true;

  var exported = 0;
  var skipped = 0;
  var errors = [];

  for (var i = 0; i < assetList.length; i++) {
    var rel = assetList[i];
    if (!/\.psd$/i.test(rel)) {
      skipped++;
      continue;
    }
    var src = new File(workspaceRoot + "/UI/" + rel.replace(/^UI\//, ""));
    if (!src.exists) {
      errors.push("missing: " + rel);
      continue;
    }
    try {
      var doc = app.open(src);
      var base = rel.replace(/\.psd$/i, "").replace(/[\\\/]/g, "_");
      var out = new File(exportDir.fsName + "/" + base + ".png");
      doc.exportDocument(out, ExportType.SAVEFORWEB, opts);
      doc.close(SaveOptions.DONOTSAVECHANGES);
      exported++;
    } catch (e) {
      errors.push(rel + ": " + e.message);
    }
  }

  var msg = "PNG 导出完成: " + exported + " 个";
  if (skipped) msg += ", 跳过非 PSD: " + skipped;
  if (errors.length) msg += "\n错误:\n" + errors.join("\n");
  alert(msg);
})();
