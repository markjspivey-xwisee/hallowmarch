;; [perf3] localPath's A* (08f_townlife.js) in WebAssembly: the same search, step for step, as lpSearchJS.
;; The page lays out one memory (see 14s_wasm.js): the grid's blocked bytes, the costs (f32), the parents (i32), the
;; stamps and the shut marks (u32, a call's own `gen`), the heap of (f, cell) as f64 and i32, and the heuristic's table
;; (Math.hypot of every |di|, |dj|, filled by the page so both ways read the same numbers).
;; search(W, H, s, g, gen, pB, pGs, pFrom, pStamp, pShut, pHf, pHk, heapCap, pHt, TW) -> 1 found, 0 none, -2 the heap
;; was too small (the page then asks the JS)
(module
  (memory (export "mem") 1)
  (func $h (param $k i32) (param $W i32) (param $gi i32) (param $gj i32) (param $pHt i32) (param $TW i32) (result f64)
    (local $di i32) (local $dj i32)
    (local.set $di (i32.sub (i32.rem_u (local.get $k) (local.get $W)) (local.get $gi)))
    (local.set $dj (i32.sub (i32.div_u (local.get $k) (local.get $W)) (local.get $gj)))
    (if (i32.lt_s (local.get $di) (i32.const 0)) (then (local.set $di (i32.sub (i32.const 0) (local.get $di)))))
    (if (i32.lt_s (local.get $dj) (i32.const 0)) (then (local.set $dj (i32.sub (i32.const 0) (local.get $dj)))))
    (f64.load (i32.add (local.get $pHt) (i32.shl (i32.add (i32.mul (local.get $dj) (local.get $TW)) (local.get $di)) (i32.const 3)))))
  (func (export "search") (param $W i32) (param $H i32) (param $s i32) (param $g i32) (param $gen i32)
        (param $pB i32) (param $pGs i32) (param $pFrom i32) (param $pStamp i32) (param $pShut i32)
        (param $pHf i32) (param $pHk i32) (param $cap i32) (param $pHt i32) (param $TW i32) (result i32)
    (local $N i32) (local $gi i32) (local $gj i32) (local $hn i32) (local $guard i32) (local $lim i32)
    (local $k i32) (local $ki i32) (local $kj i32) (local $gk f64) (local $di i32) (local $dj i32)
    (local $ni i32) (local $nj i32) (local $n2 i32) (local $ng f64) (local $fv f64)
    (local $q i32) (local $pq i32) (local $lf f64) (local $lk i32) (local $l i32) (local $r i32) (local $m i32) (local $mv f64)
    (local.set $N (i32.mul (local.get $W) (local.get $H)))
    (local.set $gi (i32.rem_u (local.get $g) (local.get $W)))
    (local.set $gj (i32.div_u (local.get $g) (local.get $W)))
    (local.set $lim (i32.mul (local.get $N) (i32.const 8)))
    ;; the start
    (i32.store (i32.add (local.get $pStamp) (i32.shl (local.get $s) (i32.const 2))) (local.get $gen))
    (f32.store (i32.add (local.get $pGs) (i32.shl (local.get $s) (i32.const 2))) (f32.const 0))
    (i32.store (i32.add (local.get $pFrom) (i32.shl (local.get $s) (i32.const 2))) (i32.const -1))
    (f64.store (local.get $pHf) (call $h (local.get $s) (local.get $W) (local.get $gi) (local.get $gj) (local.get $pHt) (local.get $TW)))
    (i32.store (local.get $pHk) (local.get $s))
    (local.set $hn (i32.const 1))
    (block $done
      (loop $main
        (br_if $done (i32.eqz (local.get $hn)))
        ;; guard++ < N * 8
        (br_if $done (i32.ge_s (local.get $guard) (local.get $lim)))
        (local.set $guard (i32.add (local.get $guard) (i32.const 1)))
        ;; pop
        (local.set $k (i32.load (local.get $pHk)))
        (local.set $hn (i32.sub (local.get $hn) (i32.const 1)))
        (if (local.get $hn) (then
          (local.set $lf (f64.load (i32.add (local.get $pHf) (i32.shl (local.get $hn) (i32.const 3)))))
          (local.set $lk (i32.load (i32.add (local.get $pHk) (i32.shl (local.get $hn) (i32.const 2)))))
          (local.set $q (i32.const 0))
          (block $sd (loop $sl
            (local.set $l (i32.add (i32.shl (local.get $q) (i32.const 1)) (i32.const 1)))
            (local.set $r (i32.add (local.get $l) (i32.const 1)))
            (local.set $m (local.get $q)) (local.set $mv (local.get $lf))
            (if (i32.lt_s (local.get $l) (local.get $hn)) (then
              (if (f64.lt (f64.load (i32.add (local.get $pHf) (i32.shl (local.get $l) (i32.const 3)))) (local.get $mv)) (then
                (local.set $m (local.get $l)) (local.set $mv (f64.load (i32.add (local.get $pHf) (i32.shl (local.get $l) (i32.const 3)))))))))
            (if (i32.lt_s (local.get $r) (local.get $hn)) (then
              (if (f64.lt (f64.load (i32.add (local.get $pHf) (i32.shl (local.get $r) (i32.const 3)))) (local.get $mv)) (then
                (local.set $m (local.get $r))))))
            (br_if $sd (i32.eq (local.get $m) (local.get $q)))
            (f64.store (i32.add (local.get $pHf) (i32.shl (local.get $q) (i32.const 3))) (f64.load (i32.add (local.get $pHf) (i32.shl (local.get $m) (i32.const 3)))))
            (i32.store (i32.add (local.get $pHk) (i32.shl (local.get $q) (i32.const 2))) (i32.load (i32.add (local.get $pHk) (i32.shl (local.get $m) (i32.const 2)))))
            (local.set $q (local.get $m))
            (br $sl)))
          (f64.store (i32.add (local.get $pHf) (i32.shl (local.get $q) (i32.const 3))) (local.get $lf))
          (i32.store (i32.add (local.get $pHk) (i32.shl (local.get $q) (i32.const 2))) (local.get $lk))))
        ;; shut already?
        (br_if $main (i32.eq (i32.load (i32.add (local.get $pShut) (i32.shl (local.get $k) (i32.const 2)))) (local.get $gen)))
        (if (i32.eq (local.get $k) (local.get $g)) (then (return (i32.const 1))))
        (i32.store (i32.add (local.get $pShut) (i32.shl (local.get $k) (i32.const 2))) (local.get $gen))
        (local.set $ki (i32.rem_u (local.get $k) (local.get $W)))
        (local.set $kj (i32.div_u (local.get $k) (local.get $W)))
        (local.set $gk (f64.promote_f32 (f32.load (i32.add (local.get $pGs) (i32.shl (local.get $k) (i32.const 2))))))
        (local.set $dj (i32.const -1))
        (loop $ldj
          (local.set $di (i32.const -1))
          (loop $ldi
            (block $next
              (br_if $next (i32.and (i32.eqz (local.get $di)) (i32.eqz (local.get $dj))))
              (local.set $ni (i32.add (local.get $ki) (local.get $di)))
              (local.set $nj (i32.add (local.get $kj) (local.get $dj)))
              (br_if $next (i32.lt_s (local.get $ni) (i32.const 0)))
              (br_if $next (i32.lt_s (local.get $nj) (i32.const 0)))
              (br_if $next (i32.ge_s (local.get $ni) (local.get $W)))
              (br_if $next (i32.ge_s (local.get $nj) (local.get $H)))
              (local.set $n2 (i32.add (i32.mul (local.get $nj) (local.get $W)) (local.get $ni)))
              (br_if $next (i32.load8_u (i32.add (local.get $pB) (local.get $n2))))
              (br_if $next (i32.eq (i32.load (i32.add (local.get $pShut) (i32.shl (local.get $n2) (i32.const 2)))) (local.get $gen)))
              (if (i32.and (i32.ne (local.get $di) (i32.const 0)) (i32.ne (local.get $dj) (i32.const 0))) (then
                (br_if $next (i32.load8_u (i32.add (local.get $pB) (i32.add (i32.mul (local.get $kj) (local.get $W)) (local.get $ni)))))
                (br_if $next (i32.load8_u (i32.add (local.get $pB) (i32.add (i32.mul (local.get $nj) (local.get $W)) (local.get $ki)))))
                (local.set $ng (f64.add (local.get $gk) (f64.const 1.4142))))
              (else (local.set $ng (f64.add (local.get $gk) (f64.const 1)))))
              (if (i32.or
                    (i32.ne (i32.load (i32.add (local.get $pStamp) (i32.shl (local.get $n2) (i32.const 2)))) (local.get $gen))
                    (f64.lt (local.get $ng) (f64.promote_f32 (f32.load (i32.add (local.get $pGs) (i32.shl (local.get $n2) (i32.const 2)))))))
                (then
                  (i32.store (i32.add (local.get $pStamp) (i32.shl (local.get $n2) (i32.const 2))) (local.get $gen))
                  (f32.store (i32.add (local.get $pGs) (i32.shl (local.get $n2) (i32.const 2))) (f32.demote_f64 (local.get $ng)))
                  (i32.store (i32.add (local.get $pFrom) (i32.shl (local.get $n2) (i32.const 2))) (local.get $k))
                  ;; push (ng + h, n2)
                  (if (i32.ge_s (local.get $hn) (local.get $cap)) (then (return (i32.const -2))))
                  (local.set $fv (f64.add (local.get $ng) (call $h (local.get $n2) (local.get $W) (local.get $gi) (local.get $gj) (local.get $pHt) (local.get $TW))))
                  (local.set $q (local.get $hn))
                  (local.set $hn (i32.add (local.get $hn) (i32.const 1)))
                  (block $ud (loop $ul
                    (br_if $ud (i32.le_s (local.get $q) (i32.const 0)))
                    (local.set $pq (i32.shr_s (i32.sub (local.get $q) (i32.const 1)) (i32.const 1)))
                    (br_if $ud (f64.le (f64.load (i32.add (local.get $pHf) (i32.shl (local.get $pq) (i32.const 3)))) (local.get $fv)))
                    (f64.store (i32.add (local.get $pHf) (i32.shl (local.get $q) (i32.const 3))) (f64.load (i32.add (local.get $pHf) (i32.shl (local.get $pq) (i32.const 3)))))
                    (i32.store (i32.add (local.get $pHk) (i32.shl (local.get $q) (i32.const 2))) (i32.load (i32.add (local.get $pHk) (i32.shl (local.get $pq) (i32.const 2)))))
                    (local.set $q (local.get $pq))
                    (br $ul)))
                  (f64.store (i32.add (local.get $pHf) (i32.shl (local.get $q) (i32.const 3))) (local.get $fv))
                  (i32.store (i32.add (local.get $pHk) (i32.shl (local.get $q) (i32.const 2))) (local.get $n2)))))
            (local.set $di (i32.add (local.get $di) (i32.const 1)))
            (br_if $ldi (i32.le_s (local.get $di) (i32.const 1))))
          (local.set $dj (i32.add (local.get $dj) (i32.const 1)))
          (br_if $ldj (i32.le_s (local.get $dj) (i32.const 1))))
        (br $main)))
    (i32.const 0))
)
