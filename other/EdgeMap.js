import { Vector3 } from 'three';
const EPSILON = 1e-8;

function quantize(n, precision = EPSILON) {
  return Math.round(n / precision);
}

class VE{
  constructor(v0) 
	{
    this.x = quantize(v0.x);
    this.y = quantize(v0.y);
    this.z = quantize(v0.z);
	}

  getKey() {
    return `${this.x}_${this.y}_${this.z}`;
  }
}

export class VEMap{
    constructor() {
        this.PointMap = new Map();
        this.point = new Vector3(); 
    }

    insertPoint(pos) {
      const ve = new VE(pos);
      const vkey = ve.getKey();
      if (!this.PointMap.has(vkey)) {
        this.PointMap.set(vkey, pos.clone());
      }
       return vkey;
    }

    getPoint(vkey) {
      return this.PointMap.get(vkey);
    }

    getAllPoints() {
      return Array.from(this.PointMap.values());
    }

    clone() {
      const newMap = new VEMap();
      for (const [key, value] of this.PointMap.entries()) {
      newMap.PointMap.set(key, value.clone());
      }
      return newMap;
    }

    clear() {
      this.PointMap.clear();
    }
}

export class InsertEdgeMap{
    constructor() {
        this.edgeMap = new Map();
    }

    insertEdge(v0,v1) {  
      this.edgeMap.set(v0, v1);
    }

    getValue(v0) {
      return this.edgeMap.get(v0);
    }

    getLoopFrom(startKey, globalVisited) {
      const path = [];
      const visited = new Set();
      let current = startKey;

      while (current !== undefined && !visited.has(current)) {
        path.push(current);
        visited.add(current);
        current = this.edgeMap.get(current);
      }

      if (current === startKey) {
        // 标记 path 中所有点为已访问
        for (const key of path) globalVisited.add(key);
        //path.push(startKey); // 闭环回到起点
        return path;
      }

      return null;
    }

    getAllLoops() {
      const globalVisited = new Set();
      const allLoops = [];

      for (const startKey of this.edgeMap.keys()) {
        if (!globalVisited.has(startKey)) {
          const loop = this.getLoopFrom(startKey, globalVisited);
          if (loop) {
            allLoops.push(loop);
          }
        }
      }

      return allLoops;
    }

    clone() {
      const newMap = new InsertEdgeMap();
      for (const [key, value] of this.edgeMap.entries()) {
      newMap.edgeMap.set(key, value);
      }
      return newMap;
    }

    clear() {
      this.edgeMap.clear();
    }
}
