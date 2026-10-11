import json,sys,statistics as st,random
S='/tmp/claude-1000/-home-ubuntu/f5db0a43-67bd-49a0-a270-bf987c43cb54/scratchpad/n5k/'
G=['grain','protein','vegetable','fruit','fat_sauce','dairy','sweet','drink','other']
def load(f): return [r for r in json.load(open(S+f)) if 'groups' in r]
def pred(r,f): return sum(f.get(g,1)*k for g,k in r['groups'].items())
def score(rows,f):
    ape=sorted(abs(pred(r,f)-r['tk'])/r['tk'] for r in rows)
    bias=st.mean((pred(r,f)-r['tk'])/r['tk'] for r in rows)
    return dict(mape=100*st.mean(ape), median=100*ape[len(ape)//2], w20=sum(a<=.2 for a in ape), n=len(rows), bias=100*bias)
def loss(rows,f,lam):
    return sum(((pred(r,f)-r['tk'])/r['tk'])**2 for r in rows)/len(rows) + sum(lam[g]*(f[g]-1)**2 for g in G)
def fit(rows):
    share={g:sum(r['groups'].get(g,0) for r in rows) for g in G}; tot=sum(share.values())
    # weaker pull toward 1 where a group carries more calories
    lam={g:0.02/max(share[g]/tot,0.01) for g in G}
    f={g:1.0 for g in G}
    for _ in range(60):
        for g in G:
            best=f[g]; bl=loss(rows,f,lam)
            for c in [x/100 for x in range(60,161,2)]:
                f[g]=c; l=loss(rows,f,lam)
                if l<bl: bl,best=l,c
            f[g]=best
    return f
def fit_global(rows):
    best=1;bl=9e9
    for c in [x/100 for x in range(60,161)]:
        f={g:c for g in G}; l=loss(rows,f,{g:0 for g in G})
        if l<bl: bl,best=l,c
    return {g:best for g in G}
tag=sys.argv[1] if len(sys.argv)>1 else ''
tr=load(f'groups-train{tag}.json'); te=load(f'groups-test{tag}.json')
one={g:1 for g in G}
fg=fit_global(tr); fp=fit(tr)
print(f"== model {tag or '3.8-flash'}  train n={len(tr)} test n={len(te)}")
for name,f in [('uncalibrated',one),('single factor %.2f'%fg['grain'],fg),('per food type',fp)]:
    a=score(tr,f); b=score(te,f)
    print(f"  {name:22} TRAIN mape {a['mape']:5.1f}% bias {a['bias']:+5.1f}% | TEST mape {b['mape']:5.1f}% median {b['median']:5.1f}% within20 {b['w20']}/{b['n']} bias {b['bias']:+5.1f}%")
print('  factors:', {g:round(v,2) for g,v in fp.items()})
share={g:round(100*sum(r['groups'].get(g,0) for r in tr)/sum(sum(r['groups'].values()) for r in tr),1) for g in G}
print('  share of predicted kcal by type (train):', share)
json.dump(fp,open(S+f'factors{tag}.json','w'))
# bootstrap: does per-type beat uncalibrated on test?
random.seed(3)
d=[abs(pred(r,fp)-r['tk'])/r['tk']-abs(pred(r,one)-r['tk'])/r['tk'] for r in te]
bs=sorted(st.mean(random.choices(d,k=len(d))) for _ in range(2000))
print(f"  per-type minus uncalibrated (TEST APE): {100*st.mean(d):+.1f} pts, 95% CI [{100*bs[50]:+.1f}, {100*bs[1950]:+.1f}]")
