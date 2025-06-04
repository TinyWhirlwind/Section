import { BufferAttribute, Vector3 } from 'three';
import { TriangleSplitter, setCutPlane} from './ExtendTriangleSplitter.js';
import { TypedAttributeData } from '../node_modules/three-bvh-csg/src/core/TypedAttributeData.js';
import { OperationDebugData } from '../node_modules/three-bvh-csg/src/core/debug/OperationDebugData.js';
import { getCutBorder, performOperation, setPlaneParam} from './ExtendOperations.js';
import { Brush } from '../node_modules/three-bvh-csg/src/core/Brush.js';
import {VEMap, InsertEdgeMap} from './EdgeMap.js'
import {getSection, testContour} from './hierarchicaltree.ts'
// merges groups with common material indices in place
function joinGroups( groups ) {

	for ( let i = 0; i < groups.length - 1; i ++ ) {

		const group = groups[ i ];
		const nextGroup = groups[ i + 1 ];
		if ( group.materialIndex === nextGroup.materialIndex ) {

			const start = group.start;
			const end = nextGroup.start + nextGroup.count;
			nextGroup.start = start;
			nextGroup.count = end - start;

			groups.splice( i, 1 );
			i --;

		}

	}

}

// initialize the target geometry and attribute data to be based on
// the given reference geometry
function prepareAttributesData( referenceGeometry, targetGeometry, attributeData, relevantAttributes ) {

	attributeData.clear();

	// initialize and clear unused data from the attribute buffers and vice versa
	const aAttributes = referenceGeometry.attributes;
	for ( let i = 0, l = relevantAttributes.length; i < l; i ++ ) {

		const key = relevantAttributes[ i ];
		const aAttr = aAttributes[ key ];
		attributeData.initializeArray( key, aAttr.array.constructor, aAttr.itemSize, aAttr.normalized );

	}

	for ( const key in attributeData.attributes ) {

		if ( ! relevantAttributes.includes( key ) ) {

			attributeData.delete( key );

		}

	}

	for ( const key in targetGeometry.attributes ) {

		if ( ! relevantAttributes.includes( key ) ) {

			targetGeometry.deleteAttribute( key );
			targetGeometry.dispose();

		}

	}

}

// Assigns the given tracked attribute data to the geometry and returns whether the
// geometry needs to be disposed of.
function assignBufferData( geometry, attributeData, groupOrder ) {

	let needsDisposal = false;
	let drawRange = - 1;

	// set the data
	const attributes = geometry.attributes;
	const referenceAttrSet = attributeData.groupAttributes[ 0 ];
	for ( const key in referenceAttrSet ) {

		const requiredLength = attributeData.getTotalLength( key );
		const type = attributeData.getType( key );
		const itemSize = attributeData.getItemSize( key );
		const normalized = attributeData.getNormalized( key );
		let geoAttr = attributes[ key ];
		if ( ! geoAttr || geoAttr.array.length < requiredLength ) {

			// create the attribute if it doesn't exist yet
			geoAttr = new BufferAttribute( new type( requiredLength ), itemSize, normalized );
			geometry.setAttribute( key, geoAttr );
			needsDisposal = true;

		}

		// assign the data to the geometry attribute buffers in the provided order
		// of the groups list
		let offset = 0;
		for ( let i = 0, l = Math.min( groupOrder.length, attributeData.groupCount ); i < l; i ++ ) {

			const index = groupOrder[ i ].index;
			const { array, type, length } = attributeData.groupAttributes[ index ][ key ];
			const trimmedArray = new type( array.buffer, 0, length );
			geoAttr.array.set( trimmedArray, offset );
			offset += trimmedArray.length;

		}

		geoAttr.needsUpdate = true;
		drawRange = requiredLength / geoAttr.itemSize;

	}

	// remove or update the index appropriately
	if ( geometry.index ) {

		const indexArray = geometry.index.array;
		if ( indexArray.length < drawRange ) {

			geometry.index = null;
			needsDisposal = true;

		} else {

			for ( let i = 0, l = indexArray.length; i < l; i ++ ) {

				indexArray[ i ] = i;

			}

		}

	}

	// initialize the groups
	let groupOffset = 0;
	geometry.clearGroups();
	for ( let i = 0, l = Math.min( groupOrder.length, attributeData.groupCount ); i < l; i ++ ) {

		const { index, materialIndex } = groupOrder[ i ];
		const vertCount = attributeData.getCount( index );
		if ( vertCount !== 0 ) {

			geometry.addGroup( groupOffset, vertCount, materialIndex );
			groupOffset += vertCount;

		}

	}

	// update the draw range
	geometry.setDrawRange( 0, drawRange );

	// remove the bounds tree if it exists because its now out of date
	// TODO: can we have this dispose in the same way that a brush does?
	// TODO: why are half edges and group indices not removed here?
	geometry.boundsTree = null;

	if ( needsDisposal ) {

		geometry.dispose();

	}

}

// Returns the list of materials used for the given set of groups
function getMaterialList( groups, materials ) {

	let result = materials;
	if ( ! Array.isArray( materials ) ) {

		result = [];
		groups.forEach( g => {

			result[ g.materialIndex ] = materials;

		} );

	}

	return result;

}

// Utility class for performing CSG operations
export class Evaluator {

	constructor() {

		this.triangleSplitter = new TriangleSplitter();
		this.attributeData = [];
		this.attributes = [ 'position', 'uv', 'normal' ];
		this.useGroups = true;
		this.consolidateGroups = true;
		this.debug = new OperationDebugData();
		this.vemap = new VEMap();
		this.insertEdgeMap  = new InsertEdgeMap();
		this.planeCenter = new Vector3(0,0,0);
		this.planeNormal = new Vector3(0,0,1);
	}

	getGroupRanges( geometry ) {
		return ! this.useGroups || geometry.groups.length === 0 ?
			[ { start: 0, count: Infinity, materialIndex: 0 } ] :
			geometry.groups.map( group => ( { ...group } ) );

	}

	getBorderList()
	{
		const { vemap, insertEdgeMap } = getCutBorder();
		this.vemap = vemap;
		this.insertEdgeMap = insertEdgeMap;
	}

	setPlane(planeCenter, planeNormal)
	{
		this.planeCenter = planeCenter;
		this.planeNormal = planeNormal;
		setPlaneParam(planeCenter, planeNormal);
		setCutPlane(planeCenter,planeNormal);
	}

	evaluate(a, b, operations, targetBrushes = new Brush()) {
		let wasArray = Array.isArray(operations);
		operations = wasArray ? operations : [operations];
		targetBrushes = Array.isArray(targetBrushes) ? targetBrushes : [targetBrushes];

		if (targetBrushes.length !== operations.length) {
			throw new Error('Evaluator: operations and target array passed as different sizes.');
		}

		a.prepareGeometry();
		b.prepareGeometry();

		const { triangleSplitter, attributeData, attributes, useGroups, consolidateGroups, debug} = this;

		// Expand attribute data only if needed
		while (attributeData.length < targetBrushes.length) {
			attributeData.push(new TypedAttributeData());
		}

		// Prepare attribute data
		targetBrushes.forEach((brush, i) => {
			prepareAttributesData(a.geometry, brush.geometry, attributeData[i], attributes);
		});

		// Run operation
		debug.init();
		performOperation(a, b, operations, triangleSplitter, attributeData, { useGroups });
		debug.complete();

		// Handle materials and groups
		const aGroups = this.getGroupRanges(a.geometry);
		const aMaterials = getMaterialList(aGroups, a.material);
		const bGroups = this.getGroupRanges(b.geometry);
		const bMaterials = getMaterialList(bGroups, b.material);
		
		// Adjust indices
		bGroups.forEach(g => g.materialIndex += aMaterials.length);
		let groups = [...aGroups, ...bGroups].map((group, index) => ({ ...group, index }));

		if (useGroups) {
			const allMaterials = [...aMaterials, ...bMaterials];
			if (consolidateGroups) {
				groups = groups.map(group => {
					const mat = allMaterials[group.materialIndex];
					group.materialIndex = allMaterials.indexOf(mat);
					return group;
				}).sort((a, b) => a.materialIndex - b.materialIndex);
			}

			// Optimize material processing
			const finalMaterials = [];
			groups.forEach((group, i) => {
				if (!finalMaterials[group.materialIndex]) {
					finalMaterials[group.materialIndex] = allMaterials[group.materialIndex];
				}
				group.materialIndex = finalMaterials.indexOf(allMaterials[group.materialIndex]);
			});

			targetBrushes.forEach(tb => {
				tb.material = finalMaterials;
			});
		} else {
			groups = [{ start: 0, count: Infinity, index: 0, materialIndex: 0 }];
			targetBrushes.forEach(tb => {
				tb.material = aMaterials[0];
			});
		}

		// Assign buffer data
		targetBrushes.forEach((brush, i) => {
			const targetGeometry = brush.geometry;
			assignBufferData(targetGeometry, attributeData[i], groups);
			if (consolidateGroups) {
				joinGroups(targetGeometry.groups);
			}
		});

		return wasArray ? targetBrushes : targetBrushes[0];
	}

	// TODO: fix
	evaluateHierarchy( root, target = new Brush() ) {

		root.updateMatrixWorld( true );

		const flatTraverse = ( obj, cb ) => {

			const children = obj.children;
			for ( let i = 0, l = children.length; i < l; i ++ ) {

				const child = children[ i ];
				if ( child.isOperationGroup ) {

					flatTraverse( child, cb );

				} else {

					cb( child );

				}

			}

		};


		const traverse = brush => {

			const children = brush.children;
			let didChange = false;
			for ( let i = 0, l = children.length; i < l; i ++ ) {

				const child = children[ i ];
				didChange = traverse( child ) || didChange;

			}

			const isDirty = brush.isDirty();
			if ( isDirty ) {

				brush.markUpdated();

			}

			if ( didChange && ! brush.isOperationGroup ) {

				let result;
				flatTraverse( brush, child => {

					if ( ! result ) {

						result = this.evaluate( brush, child, child.operation );

					} else {

						result = this.evaluate( result, child, child.operation );

					}

				} );

				brush._cachedGeometry = result.geometry;
				brush._cachedMaterials = result.material;
				return true;

			} else {

				return didChange || isDirty;

			}

		};

		traverse( root );

		target.geometry = root._cachedGeometry;
		target.material = root._cachedMaterials;

		return target;

	}

	sectionGeneration(sectionResult, matrixWorld)
	{
		const allLoops = this.insertEdgeMap.getAllLoops();
		if(allLoops.length!==0)
		{
			const all_vloop = [];
			for(let loop = 0, l = allLoops.length;loop<l;++loop)
			{
				const per_loop = allLoops[loop];
				const v_loop = [];
				for(let pl = 0,pll = per_loop.length;pl<pll;++pl)
				{
					v_loop.push(this.vemap.getPoint(per_loop[pl]));
				}
				all_vloop.push(v_loop);
			}
			const rotateMatrix = matrixWorld.clone(); 
			rotateMatrix.set(
			rotateMatrix.elements[0], rotateMatrix.elements[1], rotateMatrix.elements[2], 0, 
			rotateMatrix.elements[4], rotateMatrix.elements[5], rotateMatrix.elements[6], 0, 
			rotateMatrix.elements[8], rotateMatrix.elements[9], rotateMatrix.elements[10], 0, 
			0, 0, 0, 1 
			);
			testContour(all_vloop);
			getSection(sectionResult, this.planeNormal.clone().applyMatrix4(rotateMatrix), this.planeCenter.clone().applyMatrix4(matrixWorld), all_vloop);
		}
	}

	reset() {

		this.triangleSplitter.reset();
	}

}
