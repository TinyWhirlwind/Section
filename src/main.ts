import {
	WebGLRenderer,
	PCFSoftShadowMap,
	Scene,
	DirectionalLight,
	AmbientLight,
	PerspectiveCamera,
	BoxGeometry,
	DoubleSide,
	FrontSide,
	Mesh,
	BufferGeometry,
	MeshStandardMaterial,
	MeshBasicMaterial,
	MathUtils,
	BufferAttribute,
	Plane,
	Vector3,
	AxesHelper,
	PlaneGeometry,
	Matrix4,
	Clock,
} from 'three';
import { FBXLoader,STLExporter} from 'three/examples/jsm/Addons.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {Evaluator} from '../other/ExtendEvaluator.js' 
import {SECTION, Brush, GridMaterial, EdgesHelper, TriangleSetHelper} from '../other/index.js'
let renderer,scene,camera,light, controls,gui;
let outputContainer,transformControls;
let needsUpdate = true;
let brush1, brush2;
let resultObject,originalMaterial,wireframeResult, sectionResult;
let edgesHelper, trisHelper;
//let bvhHelper1, bvhHelper2;
let csgEvaluator;
let mergedGeometry;
let cut_width = 0.0001;
const materialMap = new Map();
const clippingPlane = new Plane(new Vector3(0, 0, 1), -0.1);
const planeNormal = new Vector3(0,0,1);
const planeCenter = new Vector3(0,0,0.1);
const _matrix1 = new Matrix4();
const _matrix2 = new Matrix4();
let direction = 1;
let t = -0.4;
let clock = new Clock();

const params = {

	brush1Shape: 'mesh',
	brush1Complexity: 1,
	brush1Color: '#ffffff',

	brush2Shape: 'plane',
	brush2Complexity: 1,
	brush2Color: '#ffffff',

	operation: SECTION,
	wireframe: true,
	displayBrushes: true,
	displayControls: true,
	shadows: false,
	vertexColors: false,
	flatShading: false,
	gridTexture: false,
	useGroups: true,

	enableDebugTelemetry: false,
	displayIntersectionEdges: false,
	displayTriangleIntersections: false,
	displayBrush1BVH: false,
	displayBrush2BVH: false,

};

async function loadModel(path: string) {
  console.time("main");
  const fbxLoader = new FBXLoader();
  const fbx = await fbxLoader.loadAsync(path);
  fbx.scale.set(0.01, 0.01, 0.01);
  const meshArray: BufferGeometry[] = [];
  console.time('loadModel');
  fbx.updateWorldMatrix(true, true);
  fbx.traverse((child) => {
    if (child instanceof Mesh) {
      child.updateMatrixWorld();
      const g = child.geometry.clone().applyMatrix4(child.matrixWorld);
      for (const key in g.attributes) {
        if (key != 'position' && key != 'normal') {
          g.deleteAttribute(key);
        }
      }
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => {
          material.clippingPlanes = [clippingPlane];
        });
      } else {
        child.material.clippingPlanes = [clippingPlane];
      }
      meshArray.push(g);
    }
  });
  const ax = new AxesHelper(5);
  mergedGeometry = mergeGeometries(meshArray);
  //scene.add(ax);
}

async function init() {

	const bgColor = 0x111111;

	outputContainer = document.getElementById( 'output' );

	// renderer setup
	renderer = new WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( bgColor, 1 );
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = PCFSoftShadowMap;
	document.body.appendChild( renderer.domElement );

	// lights
	light = new DirectionalLight( 0xffffff, 3.5 );
	light.position.set( 1, 2, -3 );
	scene.add( light, light.target );
	scene.add( new AmbientLight( 0xb0bec5, 0.35 ) );

	// shadows
	const shadowCam = light.shadow.camera;
	light.castShadow = true;
	light.shadow.mapSize.setScalar( 4096 );
	light.shadow.bias = 1e-5;
	light.shadow.normalBias = 1e-2;

	shadowCam.left = shadowCam.bottom = - 2.5;
	shadowCam.right = shadowCam.top = 2.5;
	shadowCam.updateProjectionMatrix();

	// camera setup
	camera = new PerspectiveCamera( 30, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 3, 2, -1 );
	camera.far = 100;
	camera.updateProjectionMatrix();

  
	// controls
	controls = new OrbitControls( camera, renderer.domElement );

	transformControls = new TransformControls( camera, renderer.domElement );
	transformControls.setSize( 0.5 );
	transformControls.addEventListener( 'dragging-changed', e => {

		controls.enabled = ! e.value;

	} );
	transformControls.addEventListener( 'objectChange', () => {
	//transformControls.addEventListener( 'mouseUp', () => {

		needsUpdate = true;

	} );
  	scene.add( transformControls.getHelper() );

	// bunny mesh has no UVs so skip that attribute
	csgEvaluator = new Evaluator();
	csgEvaluator.attributes = [ 'position', 'normal' ];
	csgEvaluator.setPlane(planeCenter,planeNormal);

	// initialize brushes
	brush1 = new Brush( new BoxGeometry(), new GridMaterial() );
	brush2 = new Brush( new BoxGeometry(), new GridMaterial() );

	updateBrush( brush1, params.brush1Shape, params.brush1Complexity );
	updateBrush( brush2, params.brush2Shape, params.brush2Complexity );

	// initialize materials
	brush1.material.opacity = 0.0;
	brush1.material.transparent = true;
	brush1.material.depthWrite = false;
	brush1.material.polygonOffset = true;
	brush1.material.polygonOffsetFactor = 0.2;
	brush1.material.polygonOffsetUnits = 0.2;
	brush1.material.side = DoubleSide;
	brush1.material.premultipliedAlpha = true;

	brush2.material.opacity = 0.1;
	brush2.material.transparent = true;
	brush2.material.depthWrite = false;
	brush2.material.polygonOffset = true;
	brush2.material.polygonOffsetFactor = 0.2;
	brush2.material.polygonOffsetUnits = 0.2;
	brush2.material.side = DoubleSide;
	brush2.material.premultipliedAlpha = true;
	brush2.material.roughness = 0.25;
	brush2.material.color.set( 0xffffff );

	brush1.receiveShadow = true;
	brush2.receiveShadow = true;
	transformControls.attach( brush2 );

	scene.add( brush1, brush2);

	// create material map for transparent to opaque variants
	let mat;
	mat = brush1.material.clone();
	mat.side = FrontSide;
	mat.opacity = 1;
	mat.transparent = false;
	mat.depthWrite = true;
	materialMap.set( brush1.material, mat );

	mat = brush2.material.clone();
	mat.side = FrontSide;
	mat.opacity = 1;
	mat.transparent = false;
	mat.depthWrite = true;
	materialMap.set( brush2.material, mat );

	materialMap.forEach( ( m1, m2 ) => {

		m1.enableGrid = params.gridTexture;
		m2.enableGrid = params.gridTexture;

	} );

	// add object displaying the result
	resultObject = new Mesh( new BufferGeometry(), new MeshStandardMaterial( {
		flatShading: false,
		polygonOffset: true,
		polygonOffsetUnits: 0.1,
		polygonOffsetFactor: 0.1,
	} ) );
	resultObject.castShadow = true;
	resultObject.receiveShadow = true;
	originalMaterial = resultObject.material;
	scene.add( resultObject );

	sectionResult = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ 
		color: 0x000080, 
		side: DoubleSide,
	}));
	scene.add( sectionResult );

	// add wireframe representation
	wireframeResult = new Mesh( resultObject.geometry, new MeshBasicMaterial( {
		wireframe: true,
		color: 0,
		opacity: 0.15,
		transparent: true,
	} ) );
	scene.add( wireframeResult );

	// helpers
	edgesHelper = new EdgesHelper();
	edgesHelper.color.set( 0xE91E63 );
	scene.add( edgesHelper );

	trisHelper = new TriangleSetHelper();
	trisHelper.color.set( 0x00BCD4 );
	scene.add( trisHelper );

	//bvhHelper1 = new MeshBVHVisualizer( brush1, 20 );
	//bvhHelper2 = new MeshBVHVisualizer( brush2, 20 );
	//scene.add( bvhHelper1, bvhHelper2 );

	//bvhHelper1.update();
	//bvhHelper2.update();

	// gui
	gui = new GUI();
	/*
	gui.add( params, 'operation', { SECTION} ).onChange( v => {

		needsUpdate = true;

		if ( v === HOLLOW_INTERSECTION || v === HOLLOW_SUBTRACTION ) {

			materialMap.forEach( m => m.side = DoubleSide );

		} else {

			materialMap.forEach( m => m.side = FrontSide );

		}

	} );*/
	gui.add( params, 'displayBrushes' );
	gui.add( params, 'displayControls' );
	gui.add( params, 'shadows' );
	gui.add( params, 'useGroups' ).onChange( () => needsUpdate = true );
	gui.add( params, 'vertexColors' ).onChange( v => {

		brush1.material.vertexColors = v;
		brush1.material.needsUpdate = true;

		brush2.material.vertexColors = v;
		brush2.material.needsUpdate = true;

		materialMap.forEach( m => {

			m.vertexColors = v;
			m.needsUpdate = true;

		} );

		csgEvaluator.attributes = v ?
			[ 'color', 'position', 'normal' ] :
			[ 'position', 'normal' ];

		needsUpdate = true;

	} );
	gui.add( params, 'gridTexture' ).onChange( v => {

		materialMap.forEach( ( m1, m2 ) => {

			m1.enableGrid = v;
			m2.enableGrid = v;

		} );

	} );
	gui.add( params, 'flatShading' ).onChange( v => {

		brush1.material.flatShading = v;
		brush1.material.needsUpdate = true;

		brush2.material.flatShading = v;
		brush2.material.needsUpdate = true;

		materialMap.forEach( m => {

			m.flatShading = v;
			m.needsUpdate = true;

		} );

	} );

	const brush1Folder = gui.addFolder( 'brush 1' );
	brush1Folder.add( params, 'brush1Shape', [ 'box', 'mesh', 'plane' ] ).name( 'shape' ).onChange( v => {

		updateBrush( brush1, v, params.brush1Complexity );
		//bvhHelper1.update();

	} );
	brush1Folder.add( params, 'brush1Complexity', 0, 2 ).name( 'complexity' ).onChange( v => {

		updateBrush( brush1, params.brush1Shape, v );
		//bvhHelper1.update();

	} );
	brush1Folder.addColor( params, 'brush1Color' ).onChange( v => {

		brush1.material.color.set( v );
		materialMap.get( brush1.material ).color.set( v );

	} );

	const brush2Folder = gui.addFolder( 'brush 2' );
	brush2Folder.add( params, 'brush2Shape', [ 'box', 'mesh', 'plane' ] ).name( 'shape' ).onChange( v => {

		updateBrush( brush2, v, params.brush2Complexity );
		//bvhHelper2.update();

	} );
	brush2Folder.add( params, 'brush2Complexity', 0, 2 ).name( 'complexity' ).onChange( v => {

		updateBrush( brush2, params.brush2Shape, v );
		//bvhHelper2.update();

	} );
	brush2Folder.addColor( params, 'brush2Color' ).onChange( v => {

		brush2.material.color.set( v );
		materialMap.get( brush2.material ).color.set( v );

	} );

	const debugFolder = gui.addFolder( 'debug' );
	debugFolder.add( params, 'enableDebugTelemetry' ).onChange( () => needsUpdate = true );
	debugFolder.add( params, 'displayIntersectionEdges' );
	debugFolder.add( params, 'displayTriangleIntersections' );
	debugFolder.add( params, 'wireframe' );
	debugFolder.add( params, 'displayBrush1BVH' );
	debugFolder.add( params, 'displayBrush2BVH' );

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

	window.addEventListener( 'keydown', function ( e ) {

		switch ( e.code ) {

			case 'KeyW':
				transformControls.setMode( 'translate' );
				break;
			case 'KeyE':
				transformControls.setMode( 'rotate' );
				break;
			case 'KeyR':
				transformControls.setMode( 'scale' );
				break;

		}

	} );
	render();

}

function updateBrush( brush, type, complexity ) {

	brush.geometry.dispose();
	switch ( type ) {
		case 'box':
			const dim = Math.round( MathUtils.lerp( 1, 10, complexity ) );
			brush.geometry = new BoxGeometry( 2, 2, cut_width);
			break;
		case 'mesh':
			brush.geometry = mergedGeometry;
			break;
		case 'plane':
			const plane = new PlaneGeometry(2, 2);
			plane.translate(planeCenter.x, planeCenter.y, planeCenter.z);
			brush.geometry = plane;
			break;
	}

	if(brush.geometry.index != null)
	{
		brush.geometry = brush.geometry.toNonIndexed();
	}
	const position = brush.geometry.attributes.position;
	const array = new Float32Array( position.count * 3 );
	for ( let i = 0, l = array.length; i < l; i += 9 ) {

		array[ i + 0 ] = 1;
		array[ i + 1 ] = 0;
		array[ i + 2 ] = 0;

		array[ i + 3 ] = 0;
		array[ i + 4 ] = 1;
		array[ i + 5 ] = 0;

		array[ i + 6 ] = 0;
		array[ i + 7 ] = 0;
		array[ i + 8 ] = 1;

	}

	brush.geometry.setAttribute( 'color', new BufferAttribute( array, 3 ) );
	brush.prepareGeometry();
	needsUpdate = true;
}

function render() {
	/*
	t += 0.008 * direction;
	if (t > 0.3|| t < -0.4) direction *= -1;

	brush2.position.z = t;
	transformControls.update();
	needsUpdate = true;*/

	requestAnimationFrame( render );

	brush2.scale.x = Math.max( brush2.scale.x, 0.01 );
	brush2.scale.y = Math.max( brush2.scale.y, 0.01 );
	brush2.scale.z = Math.max( brush2.scale.z, 0.01 );

	const enableDebugTelemetry = params.enableDebugTelemetry;
	if ( needsUpdate ) {

		needsUpdate = false;
		
    	sectionResult.geometry.dispose();
    	sectionResult.geometry = new BufferGeometry();
		
		brush1.updateMatrixWorld();
		brush2.updateMatrixWorld();
		const startTime = window.performance.now();

		/* web worker
		const evaluatorWorker = new Worker(new URL('./EvaluatorWorker.ts', import.meta.url), {type: 'module'});
		const inputBrush1 = brush1.geometry.toJSON();
		const inputBrush2 = brush2.geometry.toJSON();
		_matrix1.copy( brush1.matrixWorld );
		_matrix2.copy( brush2.matrixWorld );
		const payload = {geomJSON1: inputBrush1, geomJSON2: inputBrush2, matrix1:_matrix1, matrix2:_matrix2, operation: params.operation, useGroups: params.useGroups, enableDebugTelemetry: params.enableDebugTelemetry};
		evaluatorWorker.postMessage(payload);
		evaluatorWorker.onmessage = (e) => {
			if (e.data.success === false) {
				console.error('Evaluate failed:', e.data.error);
				return;
			}
			const geometryJSON = e.data.resultJSON;
			const parsedGeom = new BufferGeometryLoader().parse(geometryJSON);
			parsedGeom.applyMatrix4(e.data.resultMatix);
			const resultMesh = new Mesh(parsedGeom, new MeshBasicMaterial({
				depthTest:false
			}));
			sectionResult.geometry = resultMesh.geometry;
		}*/

		/*
		csgEvaluator.debug.enabled = params.enableDebugTelemetry;
		csgEvaluator.useGroups = params.useGroups;
		csgEvaluator.evaluate( brush1, brush2, params.operation, resultObject);
		csgEvaluator.getBorderList();
		csgEvaluator.sectionGeneration(sectionResult, brush2.matrixWorld);*/
		Section(brush1, brush2, params, sectionResult, resultObject);
		if ( params.useGroups ) {

			resultObject.material = resultObject.material.map( m => materialMap.get( m ) );

		} else {

			resultObject.material = originalMaterial;

		}

		const deltaTime = window.performance.now() - startTime;
		outputContainer.innerText = `${ deltaTime.toFixed( 3 ) }ms`;

		if ( enableDebugTelemetry ) {

			edgesHelper.setEdges( csgEvaluator.debug.intersectionEdges );

			trisHelper.setTriangles( [
				...csgEvaluator.debug.triangleIntersectsA.getTrianglesAsArray(),
				...csgEvaluator.debug.triangleIntersectsA.getIntersectionsAsArray()
			] );
		}
	}

	wireframeResult.visible = params.wireframe;
	brush1.visible = params.displayBrushes;
	brush2.visible = params.displayBrushes;

	light.castShadow = params.shadows;

	transformControls.enabled = params.displayControls;
	transformControls.visible = params.displayControls;

	edgesHelper.visible = enableDebugTelemetry && params.displayIntersectionEdges;
	trisHelper.visible = enableDebugTelemetry && params.displayTriangleIntersections;

	//bvhHelper1.visible = params.displayBrush1BVH;
	//bvhHelper2.visible = params.displayBrush2BVH;

	renderer.render( scene, camera );
}

scene = new Scene();
//await loadModel('2.fbx');
await loadModel('1.FBX');
init();


/**
 * 获取剖切补面
 * @param geometry 原始几何体
 * @param plane 剖切平面
 * @param sectionResult 剖切截面
 * @param resultObject 原始几何剖切之后的结果
 */
function Section(geometry, plane, params, sectionResult, resultObject = new Brush())
{
	csgEvaluator.debug.enabled = params.enableDebugTelemetry;
	csgEvaluator.useGroups = params.useGroups;
	//console.time("evaluate");
	csgEvaluator.evaluate( geometry, plane, params.operation, resultObject);
	//console.timeEnd("evaluate");
	csgEvaluator.getBorderList();
	csgEvaluator.sectionGeneration(sectionResult, plane.matrixWorld);
}