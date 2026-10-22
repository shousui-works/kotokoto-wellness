import test from 'node:test';import assert from 'node:assert/strict';
import {emptyState,dateKey} from '../dist/model.mjs';
import {emptyProgress,applyInterpretation,dayReport} from '../dist/progress.mjs';
import {createProgressUI} from '../dist/progress-ui.mjs';
test('calorie totals, pending labels, daily history and chart switching use saved values without mutations',async t=>{
 class Element{constructor(){this.children=[];this.listeners={};this.attrs={};this.style={};this.value='';this.dataset={};this.clientWidth=300;this.scrollLeft=0;}set textContent(s){this.text=String(s);this.children=[];}get textContent(){return (this.text??'')+this.children.map(c=>c.textContent).join('');}append(...c){this.children.push(...c);}replaceChildren(...c){this.text='';this.children=c;}setAttribute(k,v){this.attrs[k]=v;}addEventListener(type,fn){this.listeners[type]=fn;}click(){this.listeners.click?.({target:this});}}
 const today=dateKey(),legacy=emptyState(),p=emptyProgress(legacy),action=(kind,extra={})=>({operation:'create',targetId:null,kind,date:today,title:'架空の運動',evidence:'テスト',minutes:null,kcal:null,weightKg:null,detail:null,additional:false,...extra});
 const {progress}=applyInterpretation(p,{requestId:'calorie-ui',text:'テスト',actions:[action('walk',{kcal:90}),action('run',{estimatedKcal:60,estimateBasis:'架空の目安'}),action('stretch')]},legacy);
 const snapshot=JSON.stringify(progress),elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const before={document:globalThis.document,window:globalThis.window};t.after(()=>Object.assign(globalThis,before));globalThis.document={getElementById:get,createElement:()=>new Element()};globalThis.window={addEventListener(){}};
 createProgressUI({account:{user:{uid:'fictional'},state:{progress}},getState:()=>legacy});
 assert.equal(get('daily-calories').textContent,'150');assert.equal(get('daily-total-calories').textContent,'150');assert.match(get('daily-calorie-note').textContent,/推定 60kcal.*未推定 1件/);
 assert.equal(get('daily-points').textContent,String(dayReport(progress,today).total));assert.equal(get('report-calories').textContent,'150');
 get('chart-calories').click();assert.equal(get('chart-calories').attrs['aria-pressed'],'true');assert.match(get('points-chart').attrs['aria-label'],/消費カロリー/);
 const bars=get('points-chart').children;assert.equal(bars.length,14);assert.match(bars.at(-1).attrs['aria-label'],/合計150kcal/);assert.equal(bars.at(-1).children[0].textContent,'150');
 bars[0].click();assert.equal(get('report-calories').textContent,'—');assert.match(get('report-calorie-note').textContent,/まだありません/);
 get('chart-points').click();assert.equal(get('chart-points').attrs['aria-pressed'],'true');assert.match(get('points-chart').attrs['aria-label'],/えらいポイント/);assert.equal(JSON.stringify(progress),snapshot);
});
