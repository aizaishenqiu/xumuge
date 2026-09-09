#target photoshop
// 虚募阁 · 按文档/图层导出 SVG（PS CC 2015+ 可用 exportDocument）
// 较旧版本请手工「存储为 SVG」

(function () {
  var workspaceRoot = "{{XU_WORKSPACE_ROOT}}";
  var assetList = {{XU_ASSET_LIST}};
  var exportDir = new Folder(workspaceRoot + "/UI/export/svg");
  if (!exportDir.exists) exportDir.create();

  var exported = 0;
  var errors = [];

  for (var i = 0; i < assetList.length; i++) {
    var rel = assetList[i];
    if (!/\.(psd|ai)$/i.test(rel)) continue;
    var src = new File(workspaceRoot + "/UI/" + rel.replace(/^UI\//, ""));
    if (!src.exists) {
      errors.push("missing: " + rel);
      continue;
    }
    try {
      var doc = app.open(src);
      var base = rel.replace(/\.(psd|ai)$/i, "").replace(/[\\\/]/g, "_");
      var out = new File(exportDir.fsName + "/" + base + ".svg");
      // PS 2020+ 支持 ExportType.SVG；旧版会抛错
      doc.exportDocument(out, ExportType.SVG, new ExportOptionsSaveForWeb());
      doc.close(SaveOptions.DONOTSAVECHANGES);
      exported++;
    } catch (e) {
      errors.push(rel + ": " + e.message + " (旧版 PS 请手工导出 SVG)");
    }
  }

  alert("SVG 导出: " + exported + " 个\n" + (errors.length ? errors.join("\n") : ""));
})();
