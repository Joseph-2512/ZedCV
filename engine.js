/* ZedCV file engine. Body of a function(jspdf, JSZip) that returns { pdf, docx }.
   In server mode this file is only sent to the browser after a payment is verified. */
var JS = jspdf.jsPDF;
var GREEN = [20, 84, 58], MUTED = [90, 90, 90], INK = [30, 30, 30];

function newKit() {
  var d = new JS({ unit: "mm", format: "a4" });
  var W = 210, H = 297, M = 18, kit = { d: d, y: M, W: W, M: M };
  kit.ensure = function (h) { if (kit.y + h > H - M) { d.addPage(); kit.y = M; } };
  kit.text = function (str, o) {
    o = o || {};
    var size = o.size || 10, lh = size * 0.3528 * (o.lh || 1.4);
    var maxW = o.maxW || (W - 2 * M), center = o.align === "center";
    var x = center ? W / 2 : (o.x == null ? M : o.x);
    d.setFont("helvetica", o.style || "normal"); d.setFontSize(size);
    var c = o.color || INK; d.setTextColor(c[0], c[1], c[2]);
    var ls = d.splitTextToSize(String(str), maxW);
    ls.forEach(function (l) {
      kit.ensure(lh);
      if (center) d.text(l, x, kit.y + lh * 0.78, { align: "center" }); else d.text(l, x, kit.y + lh * 0.78);
      kit.y += lh;
    });
    return ls;
  };
  return kit;
}

function pdfCv(blocks) {
  var k = newKit(), d = k.d;
  blocks.forEach(function (b) {
    if (b.t === "title") {
      k.text(b.v, { size: 13, style: "bold", align: "center", lh: 1.2 }); k.y += 2;
    } else if (b.t === "name") {
      k.text(b.v, { size: 21, style: "bold", color: GREEN, lh: 1.15, align: b.c ? "center" : "left" });
    } else if (b.t === "contact") {
      k.text(b.v, { size: 9, color: MUTED, align: b.c ? "center" : "left" }); k.y += 1;
      d.setDrawColor(GREEN[0], GREEN[1], GREEN[2]); d.setLineWidth(0.6); d.line(k.M, k.y, k.W - k.M, k.y); k.y += 2;
    } else if (b.t === "h") {
      k.ensure(14); k.y += 4; k.text(b.v.toUpperCase(), { size: 10, style: "bold" });
      d.setDrawColor(170, 170, 170); d.setLineWidth(0.25); d.line(k.M, k.y, k.W - k.M, k.y); k.y += 1.6;
    } else if (b.t === "p") {
      k.text(b.v, { size: 10 });
    } else if (b.t === "kv") {
      var y0 = k.y; k.text(b.k, { size: 10, style: "bold", maxW: 50 }); var y1 = k.y;
      k.y = y0; k.text(b.v, { size: 10, x: k.M + 52, maxW: k.W - 2 * k.M - 52 }); k.y = Math.max(y1, k.y);
    } else if (b.t === "entry") {
      k.ensure(16); k.y += 1.5;
      var y2 = k.y;
      k.text(b.title, { size: 10.5, style: "bold", maxW: 120 });
      var yAfter = k.y;
      if (b.date) {
        d.setFont("helvetica", "normal"); d.setFontSize(9.5); d.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
        d.text(b.date, k.W - k.M, y2 + 10.5 * 0.3528 * 1.4 * 0.78, { align: "right" });
      }
      k.y = yAfter;
      if (b.sub) k.text(b.sub, { size: 9.5, style: "italic", color: MUTED });
      b.bullets.forEach(function (t) {
        var yb = k.y; k.ensure(6);
        k.text(t, { size: 10, x: k.M + 5, maxW: k.W - 2 * k.M - 5 });
        d.setFillColor(INK[0], INK[1], INK[2]); d.circle(k.M + 1.6, yb + 2.1, 0.5, "F");
      });
    } else if (b.t === "sig") {
      k.ensure(24); k.y += 12;
      d.setDrawColor(INK[0], INK[1], INK[2]); d.setLineWidth(0.3);
      d.line(k.M, k.y, k.M + 70, k.y); d.line(k.W - k.M - 50, k.y, k.W - k.M, k.y);
      k.y += 1;
      k.text("Signature", { size: 9, color: MUTED, maxW: 70 });
      var ys = k.y - 9 * 0.3528 * 1.4;
      d.setFont("helvetica", "normal"); d.setFontSize(9); d.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      d.text("Date", k.W - k.M - 50, ys + 9 * 0.3528 * 1.4 * 0.78);
    }
  });
  return d.output("blob");
}

function pdfLetter(blocks) {
  var k = newKit(), d = k.d;
  blocks.forEach(function (b) {
    var style = b.re || b.sign ? "bold" : "normal", maxLen = 0;
    b.lines.forEach(function (l) {
      var ls = k.text(l, { size: 11, style: style, lh: 1.45 });
      if (b.re) { d.setFont("helvetica", "bold"); d.setFontSize(11); maxLen = Math.max(maxLen, d.getTextWidth(ls[0])); }
    });
    if (b.re) {
      d.setDrawColor(INK[0], INK[1], INK[2]); d.setLineWidth(0.3);
      d.line(k.M, k.y - 0.6, k.M + Math.min(maxLen, k.W - 2 * k.M), k.y - 0.6);
    }
    k.y += b.sign ? 0 : 5;
    if (b.lines[0] === "Yours faithfully,") k.y += 10;
  });
  return d.output("blob");
}

/* ---------- Word (.docx), built by hand as WordprocessingML ---------- */
var TW = 9866; /* A4 text width in twips with 18 mm margins */
function x(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
function run(text, o) {
  o = o || {};
  var pr = (o.b ? "<w:b/>" : "") + (o.i ? "<w:i/>" : "") + (o.color ? '<w:color w:val="' + o.color + '"/>' : "") + (o.sz ? '<w:sz w:val="' + o.sz + '"/>' : "");
  return "<w:r>" + (pr ? "<w:rPr>" + pr + "</w:rPr>" : "") + '<w:t xml:space="preserve">' + x(text) + "</w:t></w:r>";
}
function runLines(text, o) { return String(text).split("\n").map(function (l) { return run(l, o); }).join("<w:r><w:br/></w:r>"); }
function para(inner, o) {
  o = o || {};
  var pp = "";
  if (o.keepNext) pp += "<w:keepNext/>";
  if (o.border) pp += '<w:pBdr><w:bottom w:val="single" w:sz="' + o.border.sz + '" w:space="2" w:color="' + o.border.color + '"/></w:pBdr>';
  if (o.tabs) pp += "<w:tabs>" + o.tabs.map(function (t) { return '<w:tab w:val="' + t.v + '" w:pos="' + t.pos + '"/>'; }).join("") + "</w:tabs>";
  pp += '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 40 : o.after) + '" w:line="276" w:lineRule="auto"/>';
  if (o.ind) pp += '<w:ind w:left="' + o.ind.left + '"' + (o.ind.hanging ? ' w:hanging="' + o.ind.hanging + '"' : "") + "/>";
  if (o.align) pp += '<w:jc w:val="' + o.align + '"/>';
  return "<w:p><w:pPr>" + pp + "</w:pPr>" + inner + "</w:p>";
}
var TAB = "<w:r><w:tab/></w:r>";

function cvBody(blocks) {
  return blocks.map(function (b) {
    switch (b.t) {
      case "title": return para(run(b.v, { b: 1, sz: 26 }), { align: "center", after: 120 });
      case "name": return para(run(b.v, { b: 1, sz: 42, color: "14543A" }), { align: b.c ? "center" : "left", after: 40 });
      case "contact": return para(run(b.v, { sz: 18, color: "5A5A5A" }), { align: b.c ? "center" : "left", border: { sz: 12, color: "14543A" }, after: 80 });
      case "h": return para(run(b.v.toUpperCase(), { b: 1, sz: 20 }), { before: 240, after: 60, keepNext: 1, border: { sz: 4, color: "AAAAAA" } });
      case "p": return para(run(b.v, { sz: 20 }));
      case "kv": return para(run(b.k, { b: 1, sz: 20 }) + TAB + run(b.v, { sz: 20 }), { tabs: [{ v: "left", pos: 2900 }], ind: { left: 2900, hanging: 2900 } });
      case "entry": {
        var out = para(run(b.title, { b: 1, sz: 21 }) + (b.date ? TAB + run(b.date, { sz: 19, color: "5A5A5A" }) : ""), { before: 120, after: 0, keepNext: 1, tabs: [{ v: "right", pos: TW }] });
        if (b.sub) out += para(run(b.sub, { i: 1, sz: 19, color: "5A5A5A" }), { after: 20 });
        b.bullets.forEach(function (t) {
          out += para(run("•") + TAB + run(t, { sz: 20 }), { after: 20, tabs: [{ v: "left", pos: 360 }], ind: { left: 360, hanging: 260 } });
        });
        return out;
      }
      case "sig":
        return para("", { before: 480, after: 0 }) +
          para(run("Signature: ______________________________", { sz: 20 }) + TAB + run("Date: ________________", { sz: 20 }), { tabs: [{ v: "right", pos: TW }] });
    }
    return "";
  }).join("");
}
function letterBody(blocks) {
  return blocks.map(function (b) {
    if (b.body) {
      return String(b.lines[0]).split(/\n\n+/).map(function (pp) { return para(runLines(pp, { sz: 22 }), { after: 160 }); }).join("");
    }
    var o = { b: b.re || b.sign, sz: 22 };
    var extra = "";
    if (b.lines[0] === "Yours faithfully,") extra = para("", { before: 480, after: 0 });
    return para(runLines(b.lines.join("\n"), o), { after: b.sign ? 0 : 200 }) + extra;
  }).join("");
}

function docx(kind, blocks) {
  var body = kind === "cv" ? cvBody(blocks) : letterBody(blocks);
  var ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + ns + "><w:body>" + body +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1020" w:right="1020" w:bottom="1020" w:left="1020" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>';
  var stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ' + ns + '><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>';
  var zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file("word/document.xml", documentXml);
  zip.file("word/styles.xml", stylesXml);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

return {
  pdf: function (kind, blocks) { return Promise.resolve(kind === "cv" ? pdfCv(blocks) : pdfLetter(blocks)); },
  docx: function (kind, blocks) { return docx(kind, blocks); }
};
