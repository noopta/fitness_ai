import React, { useMemo, useState } from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COPY, DX } from '@axiom/diagnostic-core';
import { InkButton, OutlineButton } from './primitives';

const C = DX.color;
const MAX_WINDOW = 60;

export interface TrimWindow {
  startSec: number;
  endSec: number;
}

interface Props {
  visible: boolean;
  uri: string;
  durationSec: number;
  onCancel: () => void;
  onDone: (window: TrimWindow) => void;
}

/**
 * In-app trimmer for Android, where the system picker has no video editor.
 * The preview and the two handles run in a WebView (react-native-webview is
 * already in the shipped binary, so this is OTA-safe); the chosen window is
 * sent with the upload and the server cuts the clip before analysis.
 * If the preview can't load, the handles still work over the known duration.
 */
export function TrimSheet({ visible, uri, durationSec, onCancel, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const initialEnd = Math.min(durationSec, MAX_WINDOW);
  const [win, setWin] = useState<TrimWindow>({ startSec: 0, endSec: initialEnd });
  const html = useMemo(() => trimmerHtml(uri, durationSec), [uri, durationSec]);
  const length = win.endSec - win.startSec;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <Text style={styles.title}>{COPY.trimTitle}</Text>
        <Text style={styles.hint}>{COPY.trimHint}</Text>
        <View style={styles.webWrap}>
          <WebView
            originWhitelist={['*']}
            source={{ html, baseUrl: 'file:///' }}
            allowFileAccess
            allowFileAccessFromFileURLs
            allowUniversalAccessFromFileURLs
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            scrollEnabled={false}
            style={styles.web}
            onMessage={(e) => {
              try {
                const m = JSON.parse(e.nativeEvent.data);
                if (typeof m.start === 'number' && typeof m.end === 'number') setWin({ startSec: m.start, endSec: m.end });
              } catch {
                /* ignore malformed messages */
              }
            }}
          />
        </View>
        {length > MAX_WINDOW + 0.05 ? <Text style={styles.warn}>{COPY.trimTooLong}</Text> : null}
        <View style={styles.row}>
          <OutlineButton label={COPY.trimCancel} onPress={onCancel} style={{ flex: 1 }} />
          <InkButton label={COPY.trimUse} onPress={() => onDone(win)} disabled={length > MAX_WINDOW + 0.05 || length < 0.5} style={{ flex: 1 }} />
        </View>
      </View>
    </Modal>
  );
}

function trimmerHtml(uri: string, durationSec: number): string {
  const src = JSON.stringify(uri);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>
  html,body{margin:0;background:#fff;font:14px -apple-system,Roboto,sans-serif;color:#09090b}
  .v{width:100%;height:56vh;background:#f4f4f5;border-radius:14px;object-fit:contain;display:block}
  .na{height:56vh;border-radius:14px;background:#f4f4f5;display:none;align-items:center;justify-content:center;color:#71717a;text-align:center;padding:0 24px}
  .track{position:relative;height:44px;margin:22px 14px 6px}
  .rail{position:absolute;left:0;right:0;top:19px;height:6px;border-radius:3px;background:#e4e4e7}
  .sel{position:absolute;top:19px;height:6px;border-radius:3px;background:#09090b}
  input[type=range]{position:absolute;left:0;right:0;top:0;width:100%;height:44px;margin:0;background:none;pointer-events:none;-webkit-appearance:none}
  input[type=range]::-webkit-slider-thumb{pointer-events:auto;-webkit-appearance:none;width:26px;height:44px;border-radius:8px;background:#09090b;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.25)}
  .times{display:flex;justify-content:space-between;margin:0 14px;color:#71717a;font-weight:600;font-size:13px}
  .len{text-align:center;font-weight:700;font-size:15px;margin-top:6px}
</style></head><body>
<video id="v" class="v" src=${src} playsinline muted preload="metadata"></video>
<div id="na" class="na">Preview unavailable — drag the handles to choose the rep.</div>
<div class="track"><div class="rail"></div><div id="sel" class="sel"></div>
  <input id="a" type="range" min="0" step="0.1"><input id="b" type="range" min="0" step="0.1"></div>
<div class="times"><span id="ta"></span><span id="tb"></span></div>
<div id="len" class="len"></div>
<script>
  var MAX=${MAX_WINDOW}, dur=${Number(durationSec.toFixed(2))};
  var v=document.getElementById('v'), a=document.getElementById('a'), b=document.getElementById('b');
  function fmt(t){t=Math.max(0,t);var m=Math.floor(t/60),s=(t%60).toFixed(1);return m+':'+(s<10?'0':'')+s}
  function setup(){a.max=b.max=dur;a.value=0;b.value=Math.min(dur,MAX);paint(null)}
  function paint(moved){
    var s=+a.value,e=+b.value;
    if(e-s<0.5){ if(moved===a){s=Math.max(0,e-0.5);a.value=s}else{e=Math.min(dur,s+0.5);b.value=e} }
    if(e-s>MAX){ if(moved===a){e=s+MAX;b.value=e}else{s=e-MAX;a.value=s} }
    var sel=document.getElementById('sel');sel.style.left=(s/dur*100)+'%';sel.style.width=((e-s)/dur*100)+'%';
    document.getElementById('ta').textContent=fmt(s);document.getElementById('tb').textContent=fmt(e);
    document.getElementById('len').textContent=fmt(e-s)+' selected';
    if(moved&&v.readyState>0){try{v.currentTime=moved===a?s:e}catch(_){}}
    if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({start:s,end:e}));
  }
  a.oninput=function(){paint(a)};b.oninput=function(){paint(b)};
  v.onloadedmetadata=function(){if(isFinite(v.duration)&&v.duration>0){dur=v.duration;setup()}};
  v.onerror=function(){v.style.display='none';document.getElementById('na').style.display='flex'};
  v.onclick=function(){if(v.paused){v.currentTime=+a.value;v.play()}else v.pause()};
  v.ontimeupdate=function(){if(v.currentTime>=+b.value)v.pause()};
  setup();
</script></body></html>`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.white, paddingHorizontal: 16, gap: 8 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.6, color: C.ink },
  hint: { fontSize: 14, lineHeight: 20, color: C.body },
  webWrap: { flex: 1, marginTop: 4 },
  web: { flex: 1, backgroundColor: C.white },
  warn: { fontSize: 13, fontWeight: '600', color: C.muted, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 10 },
});
