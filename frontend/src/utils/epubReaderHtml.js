export function buildReaderHtml() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes"/>
<script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js"></script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;overflow:hidden;background:#0F0E0C}
  #viewer{width:100vw;height:100vh;transform-origin:top left;will-change:transform}
  #viewer iframe{border:none !important}
  ::selection{background:rgba(232,168,56,0.3)}
</style>
</head>
<body>
<div id="viewer"></div>
<script>
(function(){
  var rn = function(d){ try{ window.ReactNativeWebView.postMessage(JSON.stringify(d)) }catch(e){} }
  var log = function(msg){ rn({type:'debug', msg: msg}) }

  var book, rendition
  var locationsReady   = false
  var pendingSeekPct   = null
  var pendingHighlights = null
  var activeHighlights  = {}
  var currentCfi        = null

  var THEMES = {
    dark:  {background:'#0F0E0C',color:'#F0EBE1','line-height':'1.75','user-select':'text','-webkit-user-select':'text'},
    light: {background:'#F8F4ED',color:'#1A1410','line-height':'1.75','user-select':'text','-webkit-user-select':'text'},
    sepia: {background:'#F5EBCF',color:'#2C1810','line-height':'1.75','user-select':'text','-webkit-user-select':'text'}
  }
  var BG = { dark:'#0F0E0C', light:'#F8F4ED', sepia:'#F5EBCF' }

  window.initReader = function(b64, savedCfi, theme, fontSize, topInset, bookId, cachedLocs){
    if(!b64){ rn({type:'error',msg:'No EPUB data'}); return }
    if(book){ try{ book.destroy() }catch(e){} }

    var bg = BG[theme] || '#0F0E0C'
    document.body.style.background = bg
    document.getElementById('viewer').style.background = bg

    var binary = atob(b64)
    var bytes   = new Uint8Array(binary.length)
    for(var i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i)

    var safeTop = topInset || 0
    var coverBuffer = bytes.buffer.slice(0)

    var renderWidth = document.documentElement.clientWidth;
    var renderHeight = Math.floor(window.innerHeight - safeTop)

    log('INIT: renderWidth='+renderWidth+' renderHeight='+renderHeight+' safeTop='+safeTop)

    book      = ePub(bytes.buffer)
    rendition = book.renderTo('viewer',{
      width:          renderWidth,
      height:         renderHeight,
      flow:           'paginated',
      spread:         'none',
      minSpreadWidth: 9999
    })

    var viewerEl = document.getElementById('viewer')
    viewerEl.style.marginTop = safeTop + 'px'
    viewerEl.style.height    = renderHeight + 'px'
    viewerEl.style.width     = renderWidth + 'px'

    rendition.themes.register('dark',  {body: THEMES.dark})
    rendition.themes.register('light', {body: THEMES.light})
    rendition.themes.register('sepia', {body: THEMES.sepia})
    rendition.themes.select(theme || 'dark')
    rendition.themes.fontSize((fontSize||17)+'px')

    currentCfi = savedCfi || null
    rendition.display(savedCfi || undefined)

    locationsReady = false

    book.ready.then(function(){
      if (cachedLocs && cachedLocs.length > 10) {
        book.locations.load(cachedLocs)
        return 'loaded'
      } else {
        return book.locations.generate(1600)
      }
    }).then(function(result){
      if(locationsReady) return
      locationsReady = true
      if (result === 'loaded') {
        rn({type:'locations_ready'})
      } else {
        rn({type:'locations_generated', data: book.locations.save()})
      }
      if(pendingHighlights){ restoreHLs(pendingHighlights); pendingHighlights = null }
      if(pendingSeekPct !== null){ doSeek(pendingSeekPct); pendingSeekPct = null }
    })

// TOC extraction — runs independently of locations
    book.loaded.navigation.then(function(nav){
      if(!nav || !nav.toc) return
      var toc = nav.toc.map(function(item){
        return {
          label: (item.label || '').trim(),
          href:  item.href,
      // Include subitems if present (nested chapters)
          subitems: (item.subitems || []).map(function(sub){
            return { label: (sub.label || '').trim(), href: sub.href }
          })
        }
      }).filter(function(item){ return item.label && item.href })
      if(toc.length > 0) rn({type:'toc', toc: toc})
    })

    book.loaded.metadata
      .then(function(meta){
        if(!meta) return
        var title  = (meta.title   || '').trim()
        var author = (meta.creator || meta.author || '').trim()
        if(title || author){ rn({type:'metadata', title:title, author:author}) }
      }).catch(function(){})

    // ── Cover extraction ──────────────────────────────────────────────────
    function resolvePath(base, rel){
      if(!rel) return null
      if(rel.startsWith('http')||rel.startsWith('data:')) return rel
      if(rel.startsWith('/')) return rel.slice(1)
      var dir   = base.includes('/') ? base.substring(0,base.lastIndexOf('/')+1) : ''
      var parts = (dir+rel).split('/')
      var out   = []
      for(var i=0;i<parts.length;i++){
        if(parts[i]==='..') out.pop()
        else if(parts[i]!=='.') out.push(parts[i])
      }
      return out.join('/')
    }

    function blobToDataUrl(blob){
      return new Promise(function(resolve,reject){
        var fr = new FileReader()
        fr.onloadend = function(){ if(fr.result&&fr.result.length>100) resolve(fr.result); else reject('empty') }
        fr.onerror   = reject
        fr.readAsDataURL(blob)
      })
    }

    function fetchUrl(url){
      return fetch(url,{
        headers:{
          'User-Agent':'Mozilla/5.0',
          'Referer':'https://standardebooks.org/',
          'Accept':'image/jpeg,image/png,*/*'
        }
      }).then(function(r){ return r.blob() }).then(blobToDataUrl)
    }

    function jsZipFallback(buffer){
      if(typeof JSZip==='undefined') return Promise.reject('no JSZip')
      return JSZip.loadAsync(buffer).then(function(zip){
        return zip.file('META-INF/container.xml').async('string').then(function(xml){
          var doc  = new DOMParser().parseFromString(xml,'text/xml')
          var rf   = doc.querySelector('rootfile')
          if(!rf) throw new Error('no rootfile')
          var opfPath  = rf.getAttribute('full-path')
          var basePath = opfPath.substring(0,opfPath.lastIndexOf('/')+1)
          return zip.file(opfPath).async('string').then(function(opfXml){
            return {zip:zip, opfXml:opfXml, basePath:basePath}
          })
        })
      }).then(function(ctx){
        var zip=ctx.zip, basePath=ctx.basePath
        var opfDoc    = new DOMParser().parseFromString(ctx.opfXml,'text/xml')
        var coverPath = null
        var metaCover = opfDoc.querySelector("meta[name='cover']")
        if(metaCover){
          var coverId   = metaCover.getAttribute('content')
          var coverItem = opfDoc.querySelector("item[id='"+coverId+"']")
          if(coverItem) coverPath = coverItem.getAttribute('href')
        }
        if(!coverPath){
          var items = opfDoc.querySelectorAll('item')
          for(var i=0;i<items.length;i++){
            var id2   = (items[i].getAttribute('id')         ||'').toLowerCase()
            var props = (items[i].getAttribute('properties') ||'').toLowerCase()
            var mt    = (items[i].getAttribute('media-type') ||'').toLowerCase()
            if((id2.indexOf('cover')>=0||props.indexOf('cover-image')>=0)&&mt.indexOf('image')>=0){
              coverPath = items[i].getAttribute('href'); break
            }
          }
        }
        if(!coverPath) throw new Error('no cover found')
        return readFromZip(zip,resolvePath(basePath,coverPath))
      })
    }

    function readFromZip(zip,exactPath){
      exactPath = exactPath.split('?')[0].split('#')[0]
      var f = zip.file(exactPath)
      if(!f){
        var name = exactPath.split('/').pop()
        var keys = Object.keys(zip.files)
        for(var i=0;i<keys.length;i++){ if(keys[i].endsWith(name)){ f=zip.file(keys[i]); break } }
      }
      if(!f) throw new Error('file not in zip: '+exactPath)
      return f.async('base64').then(function(b64){
        var ext  = exactPath.split('.').pop().toLowerCase()
        var mime = ext==='png'?'image/png':ext==='svg'?'image/svg+xml':'image/jpeg'
        return 'data:'+mime+';base64,'+b64
      })
    }

    Promise.resolve()
      .then(function(){ return book.coverUrl ? book.coverUrl() : null })
      .then(function(url){ if(url&&url.length>5) return fetchUrl(url); throw new Error('no coverUrl') })
      .catch(function(){ return jsZipFallback(coverBuffer) })
      .then(function(dataUrl){ if(dataUrl) rn({type:'cover', dataUrl:dataUrl}) })
      .catch(function(){})

    rendition.on('relocated', function(loc){
      currentCfi = loc.start.cfi
      var pct = locationsReady
        ? Math.round((book.locations.percentageFromCfi(loc.start.cfi)||0)*100)
        : 0
      rn({type:'progress', cfi:loc.start.cfi, percentage:pct})
    })

    // ── RENDERED — log everything about the spine item ────────────────────
    rendition.on("rendered", function(section){

      log("RENDERED KEYS = " + Object.keys(section).join(","));

      log("SECTION = " + JSON.stringify({
          idref: section.idref,
          href: section.href,
          index: section.index,
          canonical: section.canonical
      }));

    });

    // ── CONTENT HOOK — log what href we detect ────────────────────────────
    rendition.hooks.content.register(function(contents){
      var doc = contents.document

      // Try every possible way to get the href
      var hrefA = contents.sectionIndex !== undefined ? 'sectionIndex='+contents.sectionIndex : 'no_sectionIndex'
      var hrefB = contents.section ? (contents.section.href || 'section.href=undefined') : 'no_contents.section'
      var hrefC = doc.location ? doc.location.href : 'no_doc.location'
      var hrefD = doc.URL || 'no_doc.URL'

      // Try getting from book.spine using sectionIndex
      var spineItem = null
      var spineHref = 'no_spine'
      if(contents.sectionIndex !== undefined){
        spineItem = book.spine.get(contents.sectionIndex)
        spineHref = spineItem ? (spineItem.href || spineItem.canonical || 'spine_no_href') : 'spine_null'
      }

      log('HOOK: A='+hrefA+' B='+hrefB+' C='+hrefC.slice(-40)+' D='+hrefD.slice(-40)+' spine='+spineHref)

      // Also log the actual document body class and epub:type to confirm which page this is
      var bodyEl   = doc.body
      var bodyClass= bodyEl ? (bodyEl.className || 'no_class') : 'no_body'
      var bodyType = bodyEl ? (bodyEl.getAttribute('epub:type') || bodyEl.getAttribute('data-epub-type') || 'no_epubtype') : 'no_body'
      var sections = doc.querySelectorAll('section')
      var secInfo  = ''
      for(var i=0;i<sections.length;i++){
        secInfo += '[class='+sections[i].className+' id='+sections[i].id+']'
      }
      log('HOOK_DOM: bodyClass='+bodyClass+' bodyType='+bodyType+' sections='+secInfo)

      // Log image sizes
      var imgs = doc.querySelectorAll('img')
      for(var j=0;j<imgs.length;j++){
        log('IMG['+j+']: src='+imgs[j].src.slice(-30)+' w='+imgs[j].offsetWidth+' h='+imgs[j].offsetHeight+' naturalW='+imgs[j].naturalWidth+' naturalH='+imgs[j].naturalHeight)
      }

      // Base styles — minimal overrides only
      var style = doc.createElement('style')
      style.innerHTML =\`
          img, svg {
          max-width: 100%;
          height: auto;
        }
      \`
      setTimeout(() => {

        const body = doc.body;
        const html = doc.documentElement;

        log(
            "MEASURE " +
            contents.sectionIndex +
            " SW=" + body.scrollWidth +
            " CW=" + body.clientWidth +
            " SH=" + body.scrollHeight +
            " CH=" + body.clientHeight
        );

        log(
            "HTML SW=" +
            html.scrollWidth +
            " CW=" +
            html.clientWidth
        );

      },500);
      doc.head.appendChild(style)
      // Temporary Standard Ebooks frontmatter fix
      var fixFrontmatter = doc.createElement("style");
      fixFrontmatter.innerHTML =\`
      section.epub-type-contains-word-titlepage h1,
      section.epub-type-contains-word-titlepage p,
      section.epub-type-contains-word-imprint h2,
      section.epub-type-contains-word-colophon h2 {
          display: none !important;
          position: static !important;
          left: auto !important;
          right: auto !important;
          top: auto !important;
      }
      \`;
      doc.head.appendChild(fixFrontmatter);
      // Selection handler
      doc.addEventListener('selectionchange', function(){
        var sel  = doc.getSelection()
        var text = sel ? sel.toString().trim() : ''
        if(text.length > 5){
          try{
            var cfiRange = contents.cfiFromRange(sel.getRangeAt(0))
            rn({type:'selection', text:text, cfi:cfiRange, isHighlighted:!!activeHighlights[cfiRange]})
          }catch(e){}
        }
      })

      // Touch handler
      var tX=0,tY=0,tT=0,tMoved=false
      doc.addEventListener('touchstart',function(e){
        if(e.touches.length===1){tX=e.touches[0].clientX;tY=e.touches[0].clientY;tT=Date.now();tMoved=false}
      },{passive:true})
      doc.addEventListener('touchmove',function(e){
        if(e.touches.length===1&&(Math.abs(e.touches[0].clientX-tX)>8||Math.abs(e.touches[0].clientY-tY)>8)) tMoved=true
      },{passive:true})
      doc.addEventListener('touchend',function(e){
        var sel = doc.getSelection()
        if(sel&&sel.toString().trim().length>0) return
        var dx=e.changedTouches[0].clientX-tX, adx=Math.abs(dx)
        var ady=Math.abs(e.changedTouches[0].clientY-tY), dt=Date.now()-tT
        if(adx>50&&ady<60&&dt<500){ if(window.currentScale<=1.05){ dx<0?rendition.next():rendition.prev() } }
        else if(!tMoved&&dt<300){ rn({type:'tap'}) }
      },{passive:true})
    })

    // ── Pinch zoom ────────────────────────────────────────────────────────
    var viewer=document.getElementById('viewer')
    var scale=1; window.currentScale=1
    var tx=0,ty=0,pinching=false,pinchD0=0,pinchS0=1,pmx=0,pmy=0
    function dist(t){ return Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY) }
    function applyT(){
      var mx=Math.max(0,(scale-1)*window.innerWidth/2),my=Math.max(0,(scale-1)*window.innerHeight/2)
      tx=Math.min(mx,Math.max(-mx,tx)); ty=Math.min(my,Math.max(-my,ty))
      viewer.style.transform='translate('+tx+'px,'+ty+'px) scale('+scale+')'
      window.currentScale=scale
    }
    document.addEventListener('touchstart',function(e){
      if(e.touches.length===2){pinching=true;pinchD0=dist(e.touches);pinchS0=scale;pmx=(e.touches[0].clientX+e.touches[1].clientX)/2;pmy=(e.touches[0].clientY+e.touches[1].clientY)/2;e.preventDefault()}
    },{passive:false})
    document.addEventListener('touchmove',function(e){
      if(e.touches.length===2&&pinching){e.preventDefault();var ns=Math.min(3,Math.max(1,pinchS0*dist(e.touches)/pinchD0));var ds=ns-scale;tx-=ds*(pmx-window.innerWidth/2);ty-=ds*(pmy-window.innerHeight/2);scale=ns;applyT()}
    },{passive:false})
    document.addEventListener('touchend',function(e){
      if(pinching&&e.touches.length<2){pinching=false;if(scale<1.08){scale=1;tx=0;ty=0;applyT()}}
    })
    var lastTap=0
    document.addEventListener('touchend',function(e){
      if(e.touches.length>0) return
      var now=Date.now(); if(now-lastTap<280&&scale>1.05){scale=1;tx=0;ty=0;applyT()} lastTap=now
    })
  }

  function doSeek(pct){
    try{
      var cfi = book.locations.cfiFromPercentage(Math.min(1,Math.max(0,pct/100)))
      if(cfi) rendition.display(cfi)
    }catch(e){}
  }

  function restoreHLs(cfis){
    cfis.forEach(function(cfi){
      try{
        rendition.annotations.highlight(cfi,{},(e)=>{},'hl-user',{'fill':'rgba(232,168,56,0.40)'})
        activeHighlights[cfi]=true
      }catch(e){}
    })
  }
    

  window.epubNext = function(){ rendition&&rendition.next() }
  window.epubPrev = function(){ rendition&&rendition.prev() }

  window.epubTheme = function(th){
    if(!rendition) return
    var bg = BG[th] || '#0F0E0C'
    document.body.style.background = bg
    document.getElementById('viewer').style.background = bg
    rendition.themes.select(th)
    var cfi = currentCfi || undefined
    setTimeout(function(){ try{ rendition.display(cfi) }catch(e){} }, 50)
  }

  window.epubFont = function(sz){
    if(!rendition) return
    rendition.themes.fontSize(sz+'px')
    var cfi = currentCfi || undefined
    setTimeout(function(){ try{ rendition.display(cfi) }catch(e){} }, 50)
  }

  window.epubDisplay = function(cfi){ rendition&&rendition.display(cfi) }

  window.epubSeek = function(pct){
    if(!rendition) return
    if(locationsReady) doSeek(pct)
    else pendingSeekPct = pct
  }

  window.epubHighlight = function(cfi){
    try{ rendition.annotations.highlight(cfi,{},(e)=>{},'hl-user',{'fill':'rgba(232,168,56,0.40)'}); activeHighlights[cfi]=true }catch(e){}
  }
  window.epubRemoveHighlight = function(cfi){
    try{ rendition.annotations.remove(cfi,'highlight'); delete activeHighlights[cfi] }catch(e){}
  }

  window.epubRestoreHighlights = function(cfisJson){
    try{
      var cfis = JSON.parse(cfisJson)
      if(locationsReady) restoreHLs(cfis)
      else pendingHighlights = cfis
    }catch(e){}
  }

  // ── In-book search ────────────────────────────────────────────────────────
  // Searches all spine items for query string, returns array of CFI locations.
  // Results are sent back via postMessage({ type:'searchResults', results:[...] })
  // Each result: { cfi, excerpt } where excerpt is surrounding text for display.
  // ── In-book search ────────────────────────────────────────────────────────
  window.searchBook = function(query) {
    if(!book || !query || query.trim().length < 2) {
      rn({ type:'searchResults', results:[], query:query })
      return
    }
    rn({ type:'searchStart', query:query })

    var q = query.trim().toLowerCase()
    var searchPromises = []

    // 1. Iterate through spine items and collect the Promises
    book.spine.each(function(section) {
      var sectionPromise = section.load(book.load.bind(book))
        .then(function() {
          // find() returns an array of { cfi, excerpt }
          var found = section.find(q)
          return found || []
        })
        .finally(function() {
          section.unload()  // free memory after each section
        })
      
      searchPromises.push(sectionPromise)
    })

    // 2. Wait for ALL sections to finish searching
    Promise.all(searchPromises)
      .then(function(resultsArrays) {
        // resultsArrays is an array of arrays. We need to flatten it.
        var finalResults = []
        for(var i = 0; i < resultsArrays.length; i++) {
          finalResults = finalResults.concat(resultsArrays[i])
        }
        
        // Cap at 200 results
        rn({ type:'searchResults', results: finalResults.slice(0, 200), query: query })
      })
      .catch(function(err) {
        rn({ type:'searchResults', results:[], query:query, error:err.message })
      })
  }

  // Jump to a specific search result CFI and highlight it
  window.goToSearchResult = function(cfi) {
    if(!rendition || !cfi) return
    rendition.display(cfi).then(function() {
      // Clear previous search highlights then add new one
      try { rendition.annotations.remove(window._lastSearchCfi, 'highlight') } catch(e){}
      rendition.annotations.highlight(cfi, {}, function(){}, 'search-highlight', {
        'fill':         'rgba(255,200,0,0.45)',
        'fill-opacity': '1',
      })
      window._lastSearchCfi = cfi
    }).catch(function(){})
  }

  // Clear search highlights when search is dismissed
  window.clearSearchHighlight = function() {
    if(!rendition || !window._lastSearchCfi) return
    try { rendition.annotations.remove(window._lastSearchCfi, 'highlight') } catch(e){}
    window._lastSearchCfi = null
  }
})()
</script>
</body>
</html>`;
}