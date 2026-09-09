#target photoshop
// 虚募阁 · 图层命名规范化（snake_case，去空格）

(function () {
  function normalize(name) {
    return String(name)
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, "")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .toLowerCase();
  }

  function walk(layers, prefix) {
    var renamed = 0;
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      var next = prefix ? prefix + "/" + normalize(layer.name) : normalize(layer.name);
      if (layer.name !== next.split("/").pop()) {
        layer.name = next.split("/").pop();
        renamed++;
      }
      if (layer.typename === "LayerSet") {
        renamed += walk(layer.layers, next);
      }
    }
    return renamed;
  }

  if (!app.documents.length) {
    alert("请先打开要规范化的文档");
    return;
  }
  var doc = app.activeDocument;
  var count = walk(doc.layers, "");
  alert("已规范化图层名: " + count + " 处");
})();
