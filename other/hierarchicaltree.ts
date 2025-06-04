import {Vector3, Mesh, Float32BufferAttribute, MeshBasicMaterial, DoubleSide, Matrix4} from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
//declare function triangulate(contours: Float32Array[], planeNormal: Vector3): number[];
//declare var tessy: any;


class HierarchicalNode{
    public isHole: boolean;
    public parent: HierarchicalNode | null;
    public children: HierarchicalNode[];
    public contour: Vector3[];
    public area: number;

    constructor(contour: Vector3[], isHole: boolean = false, area: number = 0)
    {
        this.isHole = isHole; 
        this.parent = null;
        this.children = [];
        this.contour = contour;
        this.area = area; 
    }

    addChild(childNode: HierarchicalNode):void
    {
        this.children.push(childNode);
    }
}

export function testContour(all_vloop)
{
    const {outerRect, innerRect} = classContours(all_vloop);
    for(let i = 0,l = outerRect.length ; i < l; ++ i)
    {
        const contours = [];
        const per_contour = [];
        for (const outer of outerRect[i].contour)
        {
            per_contour.push(outer.x);
            per_contour.push(outer.y);
        }
        contours.push(per_contour);
        //exportPointsAsOBJ(per_contour,'points_outer.obj');
        //const polyTriangles = triangulate(contours); 
        //const mesh = createMeshFromTriangles(polyTriangles);
        //exportAsOBJ(mesh, 'triangulate_outer.obj');
    }

    for(let i = 0, l = innerRect.length ; i < l; ++ i)
    {
        const contours = [];
        const per_contour = [];
        for (const hole of innerRect[i].contour)
        {
            per_contour.push(hole.x);
            per_contour.push(hole.y);
        }
        contours.push(per_contour);
        //exportPointsAsOBJ(per_contour,'points_hole.obj');
        //const polyTriangles = triangulate(contours); 
        //const mesh = createMeshFromTriangles(polyTriangles);
        //exportAsOBJ(mesh, 'triangulate_inner.obj');
    }
}

export function getSection(sectionResult, planeNormal, planeCenter, all_vloop)
{
    if(all_vloop.length === 0 )
        return null; 
    const normal = planeNormal.normalize();
    const finalMatrix = rotateToXOY(normal, planeCenter, all_vloop);
    const translatMatrix = finalMatrix.clone().invert();

    const {outerRect, innerRect} =  pairContours(all_vloop);
    let alltriangles = [];
    for(const outerNode of outerRect)
    {
        const contours = [];
        const per_contour = [];
        for(let i =0,l = outerNode.contour.length;i<l;++i)
        {
            per_contour.push(outerNode.contour[i].x);
            per_contour.push(outerNode.contour[i].y);
        }
        contours.push(per_contour);
        for(const child of outerNode.children)
        {
            const per_inner_contour = [];
            for(const p of child.contour)
            {
                per_inner_contour.push(p.x);
                per_inner_contour.push(p.y);
            }
            contours.push(per_inner_contour);
        }

        const polyTriangles = triangulate(contours, planeNormal); 
        for(const p of polyTriangles)
        {
            alltriangles.push(p);
        }
    }
   
    const triangleVerts = [];
    for(let i = 0, l = alltriangles.length; i < l; i += 2)
    {
        const p = new Vector3(alltriangles[i], alltriangles[i+1], 0).applyMatrix4(translatMatrix);
        triangleVerts.push(p.x,p.y,p.z);
    }
    createMeshFromTriangles(sectionResult.geometry, triangleVerts);
}

function rotateToXOY(planeNormal, planeCenter, all_vloop)
{
    const target = new Vector3(0, 0, 1);
    const axis = new Vector3().crossVectors(planeNormal, target).normalize();
    let rotateMatrix = new Matrix4();
    if (axis.lengthSq() > 1e-10) { 
        axis.normalize();
        const angle = Math.acos(planeNormal.dot(target));
        rotateMatrix.makeRotationAxis(axis, angle);
    } else {
        rotateMatrix.identity();
    }
    const translateMatrix = new Matrix4().makeTranslation(-planeCenter.x,-planeCenter.y,-planeCenter.z);
    const finalMatrix = new Matrix4().multiplyMatrices(rotateMatrix, translateMatrix);
    for(const loop of all_vloop)
    {
        for(const p of loop)
        {
            p.applyMatrix4(finalMatrix);
        }
    }
    return finalMatrix;
}

function pairContours(all_vloop)
{
    const {outerRect, innerRect} = classContours(all_vloop);
    
    for (const innerNode of innerRect)
    {
        for(const outerNode of outerRect)
        {
            if (isPointInPolygon(innerNode.contour[0], outerNode.contour) && Math.abs(outerNode.area) > Math.abs(innerNode.area)) 
            {
                if(innerNode.parent === null)
                {
                    innerNode.parent = outerNode;
                    //console.log("innerNode`s parent is current outerNode");
                }
                else
                {
                    if (isPointInPolygon(outerNode.contour[0], innerNode.parent.contour) && Math.abs(innerNode.parent.area) > Math.abs(outerNode.area))
                    {
                        innerNode.parent = outerNode;
                        //console.log("innerNode`s parent change current outerNode");
                    }
                }
			}
            else{
                //console.log("innerNode`s parent is not current outerNode");
            }
        }
    }

    
    for(const innerNode of innerRect)
    {
        if(innerNode.parent === null)
        {
            console.warn('The current inner ring did not find a matching outer ring');
        }
        else
        {
            innerNode.parent.addChild(innerNode);   
        }
    }
    return {outerRect, innerRect};
}

function computeLoopOrientation(loopPoints)
{
	let area = 0;
	const n = loopPoints.length;
	for(let i = 0 ; i < n ; ++ i)
	{
		const p1 = loopPoints[i];
    	const p2 = loopPoints[(i + 1) % n]; 
		area += (p1.x * p2.y - p2.x * p1.y);
	}
	return area;
}

function classContours(all_vloop)
{
	const outerRect = [];
	const innerRect = []; 
	for(const loop of all_vloop)
	{
        const area = computeLoopOrientation(loop);
		if(area > 0)
		{
            const outerNode = new HierarchicalNode(loop,false,area);
			outerRect.push(outerNode);
		}
		else
		{
            const innerNode = new HierarchicalNode(loop,true,area);
			innerRect.push(innerNode);	
		}
	}
	return {outerRect, innerRect};
}

function sgn(x) {
  return (x > 0) ? 1 : (x < 0 ? -1 : 0);
}

function isPointInPolygon(point, vertices)
{
	const size = vertices.length;
	const x = point.x;
	const y = point.y;

	let xMin = vertices[0].x;
	let xMax = vertices[0].x;
	let yMin = vertices[0].y;
	let yMax = vertices[0].y;

	for (let i = 0; i < size; i++) {
		if (vertices[i].x < xMin) xMin = vertices[i].x;
		if (vertices[i].x > xMax) xMax = vertices[i].x;
		if (vertices[i].y < yMin) yMin = vertices[i].y;
		if (vertices[i].y > yMax) yMax = vertices[i].y;

		vertices[i].x = vertices[i].x - x;
		vertices[i].y = vertices[i].y - y;
	}

	if (x < xMin || x > xMax || y < yMin || y > yMax) {
		for (let i = 0; i < size; i++) {
		vertices[i].x = vertices[i].x + x;
		vertices[i].y = vertices[i].y + y;
		}
		return false;
	}

	const quad = new Array(size);
	for (let i = 0; i < size; i++) {
		const posX = vertices[i].x > 0;
		const posY = vertices[i].y > 0;
		const negX = !posX;
		const negY = !posY;
		quad[i] = (negX && posY ? 1 : 0) + (negX && negY ? 2 : 0) + (posX && negY ? 3 : 0);
	}

	const diffQuad = [];
	for (let i = 1; i < size; i++) {
		diffQuad.push(quad[i] - quad[i - 1]);
	}
	diffQuad.push(quad[0] - quad[size - 1]);

	for (let i = 0; i < size; i++) {
		const absDiff = Math.abs(diffQuad[i]);
		if (absDiff === 3) {
		diffQuad[i] = -sgn(diffQuad[i]);
		} else if (absDiff === 2) {
		const curr = vertices[i];
		const next = vertices[(i + 1) % size];
		diffQuad[i] = 2 * sgn(curr.x * next.y - next.x * curr.y);
		}
	}

	const sum = diffQuad.reduce((acc, val) => acc + val, 0);
	const position = sum !== 0 ? true : false;

	for (let i = 0; i < size; i++) {
		vertices[i].x = vertices[i].x + x;
		vertices[i].y = vertices[i].y + y;
	}

  	return position;
}

function createMeshFromTriangles(geometry, triangleVerts) {

  geometry.setAttribute('position', new Float32BufferAttribute(triangleVerts, 3));

  const indexCount = triangleVerts.length / 3;
  const indices = [];
  for (let i = 0; i < indexCount; i += 3) {
    indices.push(i, i + 1, i + 2);
  }
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
}

function exportAsOBJ(mesh: Mesh, path:string) {
  const exporter = new OBJExporter();
  const result = exporter.parse(mesh);

  const blob = new Blob([result], { type: 'text/plain' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = path;
  link.click();
}

function exportPointsAsOBJ(points, fileName = 'points.obj') {

  let objData = '';
  for (const point of points) {
    objData += `v ${point.x} ${point.y} ${point.z}\n`;
  }
  const blob = new Blob([objData], { type: 'text/plain' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
}
