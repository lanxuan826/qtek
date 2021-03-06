/**
 * StaticGeometry can not be changed once they've been setup
 */
define(function(require) {

    'use strict';

    var Geometry = require('./Geometry');
    var BoundingBox = require('./math/BoundingBox');
    var glMatrix = require('./dep/glmatrix');
    var vendor = require('./core/vendor');
    var glenum = require('./core/glenum');
    var mat4 = glMatrix.mat4;
    var vec3 = glMatrix.vec3;

    var Attribute = Geometry.Attribute;
    var vec3Create = vec3.create;
    var vec3Add = vec3.add;
    var vec3Set = vec3.set;

    /**
     * @constructor qtek.StaticGeometry
     * @extends qtek.Geometry
     */
    var StaticGeometry = Geometry.derive(function() {
        return /** @lends qtek.StaticGeometry# */ {
            attributes: {
                 position: new Attribute('position', 'float', 3, 'POSITION', false),
                 texcoord0: new Attribute('texcoord0', 'float', 2, 'TEXCOORD_0', false),
                 texcoord1: new Attribute('texcoord1', 'float', 2, 'TEXCOORD_1', false),
                 normal: new Attribute('normal', 'float', 3, 'NORMAL', false),
                 tangent: new Attribute('tangent', 'float', 4, 'TANGENT', false),
                 color: new Attribute('color', 'float', 4, 'COLOR', false),
                 // Skinning attributes
                 // Each vertex can be bind to 4 bones, because the 
                 // sum of weights is 1, so the weights is stored in vec3 and the last
                 // can be calculated by 1-w.x-w.y-w.z
                 weight: new Attribute('weight', 'float', 3, 'WEIGHT', false),
                 joint: new Attribute('joint', 'float', 4, 'JOINT', false),
                 // For wireframe display
                 // http://codeflow.org/entries/2012/aug/02/easy-wireframe-display-with-barycentric-coordinates/
                 barycentric: new Attribute('barycentric', 'float', 3, null, false),
            },

            hint: glenum.STATIC_DRAW,

            /**
             * @type {Uint16Array}
             */
            faces: null,

            _normalType: 'vertex',

            _enabledAttributes: null
        };
    }, 
    /** @lends qtek.StaticGeometry.prototype */
    {
        dirty: function() {
            this._cache.dirtyAll();
            this._enabledAttributes = null;
        },
        
        getVertexNumber: function() {
            var mainAttribute = this.attributes[this.mainAttribute];
            if (!mainAttribute || !mainAttribute.value) {
                return 0;
            }
            return mainAttribute.value.length / mainAttribute.size;
        },

        getFaceNumber: function() {
            var faces = this.faces;
            if (!faces) {
                return 0;
            } else {
                return faces.length / 3;
            }
        },

        getFace: function (idx, out) {
            if (idx < this.getFaceNumber() && idx >= 0) {
                if (!out) {
                    out = vec3Create();
                }
                var faces = this.faces;
                out[0] = faces[idx * 3];
                out[1] = faces[idx * 3 + 1];
                out[2] = faces[idx * 3 + 2];
                return out;
            }
        },
        
        isUseFace: function() {
            return this.useFace && (this.faces != null);
        },
        
        createAttribute: function(name, type, size, semantic) {
            var attrib = new Attribute(name, type, size, semantic, false);
            this.attributes[name] = attrib;
            this._attributeList.push(name);
            return attrib;
        },

        removeAttribute: function(name) {
            var idx = attributeList.indexOf(name);
            if (idx >= 0) {
                attributeList.splice(idx, 1);
                delete this.attributes[name];
                return true;
            }
            return false;
        },

        /**
         * Get enabled attributes name list
         * Attribute which has the same vertex number with position is treated as a enabled attribute
         * @return {string[]}
         */
        getEnabledAttributes: function() {
            var enabledAttributes = this._enabledAttributes;
            var attributeList = this._attributeList;
            // Cache
            if (enabledAttributes) {
                return enabledAttributes;
            }

            var result = [];
            var nVertex = this.getVertexNumber();

            for (var i = 0; i < attributeList.length; i++) {
                var name = attributeList[i];
                var attrib = this.attributes[name];
                if (attrib.value) {
                    if (attrib.value.length === nVertex * attrib.size) {
                        result.push(name);
                    }
                }
            }

            this._enabledAttributes = result;

            return result;
        },

        getBufferChunks: function(_gl) {
            var cache = this._cache;
            cache.use(_gl.__GLID__);
            if (cache.isDirty()) {
                this._updateBuffer(_gl);
                cache.fresh();
            }
            return cache.get('chunks');
        },
        
        _updateBuffer: function(_gl) {
            var chunks = this._cache.get('chunks');
            var firstUpdate = false;
            if (! chunks) {
                chunks = [];
                // Intialize
                chunks[0] = {
                    attributeBuffers: [],
                    indicesBuffer: null
                };
                this._cache.put('chunks', chunks);
                firstUpdate = true;
            }
            var chunk = chunks[0];
            var attributeBuffers = chunk.attributeBuffers;
            var indicesBuffer = chunk.indicesBuffer;

            var attributeList = this.getEnabledAttributes();
            var prevSearchIdx = 0;
            var count = 0;
            for (var k = 0; k < attributeList.length; k++) {
                var name = attributeList[k];
                var attribute = this.attributes[name];

                var bufferInfo;

                if (!firstUpdate) {
                    // Search for created buffer
                    for (var i = prevSearchIdx; i < attributeBuffers.length; i++) {
                        if (attributeBuffers[i].name === name) {
                            bufferInfo = attributeBuffers[i];
                            prevSearchIdx = i + 1;
                            break;
                        }
                    }
                    if (!bufferInfo) {
                        for (var i = prevSearchIdx - 1; i >= 0; i--) {
                            if (attributeBuffers[i].name === name) {
                                bufferInfo = attributeBuffers[i];
                                prevSearchIdx = i;
                                break;
                            }
                        }
                    }
                }
                var buffer;
                if (bufferInfo) {
                    buffer = bufferInfo.buffer;
                } else {
                    buffer = _gl.createBuffer();
                }
                //TODO: Use BufferSubData?
                _gl.bindBuffer(_gl.ARRAY_BUFFER, buffer);
                _gl.bufferData(_gl.ARRAY_BUFFER, attribute.value, this.hint);

                attributeBuffers[count++] = new Geometry.AttributeBuffer(name, attribute.type, buffer, attribute.size, attribute.semantic);
            }
            attributeBuffers.length = count;

            if (this.isUseFace()) {
                if (!indicesBuffer) {
                    indicesBuffer = new Geometry.IndicesBuffer(_gl.createBuffer());
                    chunk.indicesBuffer = indicesBuffer;
                }
                indicesBuffer.count = this.faces.length;
                _gl.bindBuffer(_gl.ELEMENT_ARRAY_BUFFER, indicesBuffer.buffer);
                _gl.bufferData(_gl.ELEMENT_ARRAY_BUFFER, this.faces, this.hint);
            }
        },

        generateVertexNormals: function() {
            var faces = this.faces;
            var attributes = this.attributes;
            var positions = attributes.position.value;
            var normals = attributes.normal.value;

            if (!normals || normals.length !== positions.length) {
                normals = attributes.normal.value = new vendor.Float32Array(positions.length);
            } else {
                // Reset
                for (var i = 0; i < normals.length; i++) {
                    normals[i] = 0;
                }
            }

            var p1 = vec3Create();
            var p2 = vec3Create();
            var p3 = vec3Create();

            var v21 = vec3Create();
            var v32 = vec3Create();

            var n = vec3Create();

            for (var f = 0; f < faces.length;) {
                var i1 = faces[f++];
                var i2 = faces[f++];
                var i3 = faces[f++];

                vec3Set(p1, positions[i1*3], positions[i1*3+1], positions[i1*3+2]);
                vec3Set(p2, positions[i2*3], positions[i2*3+1], positions[i2*3+2]);
                vec3Set(p3, positions[i3*3], positions[i3*3+1], positions[i3*3+2]);

                vec3.sub(v21, p1, p2);
                vec3.sub(v32, p2, p3);
                vec3.cross(n, v21, v32);
                // Weighted by the triangle area
                for (var i = 0; i < 3; i++) {
                    normals[i1*3+i] = normals[i1*3+i] + n[i];
                    normals[i2*3+i] = normals[i2*3+i] + n[i];
                    normals[i3*3+i] = normals[i3*3+i] + n[i];
                }
            }

            for (var i = 0; i < normals.length;) {
                vec3Set(n, normals[i], normals[i+1], normals[i+2]);
                vec3.normalize(n, n);
                normals[i++] = n[0];
                normals[i++] = n[1];
                normals[i++] = n[2];
            }
        },

        generateFaceNormals: function() {
            if (!this.isUniqueVertex()) {
                this.generateUniqueVertex();
            }

            var faces = this.faces;
            var attributes = this.attributes;
            var positions = attributes.position.value;
            var normals = attributes.normal.value;

            var p1 = vec3Create();
            var p2 = vec3Create();
            var p3 = vec3Create();

            var v21 = vec3Create();
            var v32 = vec3Create();
            var n = vec3Create();

            if (!normals) {
                normals = attributes.position.value = new Float32Array(positions.length);
            }
            for (var f = 0; f < faces.length;) {
                var i1 = faces[f++];
                var i2 = faces[f++];
                var i3 = faces[f++];

                vec3Set(p1, positions[i1*3], positions[i1*3+1], positions[i1*3+2]);
                vec3Set(p2, positions[i2*3], positions[i2*3+1], positions[i2*3+2]);
                vec3Set(p3, positions[i3*3], positions[i3*3+1], positions[i3*3+2]);

                vec3.sub(v21, p1, p2);
                vec3.sub(v32, p2, p3);
                vec3.cross(n, v21, v32);

                vec3.normalize(n, n);

                for (var i = 0; i < 3; i++) {
                    normals[i1*3+i] = n[i];
                    normals[i2*3+i] = n[i];
                    normals[i3*3+i] = n[i];
                }
            }
        },

        generateTangents: function() {
            var nVertex = this.getVertexNumber();
            var attributes = this.attributes;
            if (!attributes.tangent.value) {
                attributes.tangent.value = new Float32Array(nVertex * 4);
            }
            var texcoords = attributes.texcoord0.value;
            var positions = attributes.position.value;
            var tangents = attributes.tangent.value;
            var normals = attributes.normal.value;

            var tan1 = [];
            var tan2 = [];
            for (var i = 0; i < nVertex; i++) {
                tan1[i] = [0.0, 0.0, 0.0];
                tan2[i] = [0.0, 0.0, 0.0];
            }

            var sdir = [0.0, 0.0, 0.0];
            var tdir = [0.0, 0.0, 0.0];
            var faces = this.faces;
            for (var i = 0; i < faces.length;) {
                var i1 = faces[i++],
                    i2 = faces[i++],
                    i3 = faces[i++],

                    st1s = texcoords[i1 * 2],
                    st2s = texcoords[i2 * 2],
                    st3s = texcoords[i3 * 2],
                    st1t = texcoords[i1 * 2 + 1],
                    st2t = texcoords[i2 * 2 + 1],
                    st3t = texcoords[i3 * 2 + 1],

                    p1x = positions[i1 * 3],
                    p2x = positions[i2 * 3],
                    p3x = positions[i3 * 3],
                    p1y = positions[i1 * 3 + 1],
                    p2y = positions[i2 * 3 + 1],
                    p3y = positions[i3 * 3 + 1],
                    p1z = positions[i1 * 3 + 2],
                    p2z = positions[i2 * 3 + 2],
                    p3z = positions[i3 * 3 + 2];

                var x1 = p2x - p1x,
                    x2 = p3x - p1x,
                    y1 = p2y - p1y,
                    y2 = p3y - p1y,
                    z1 = p2z - p1z,
                    z2 = p3z - p1z;

                var s1 = st2s - st1s,
                    s2 = st3s - st1s,
                    t1 = st2t - st1t,
                    t2 = st3t - st1t;

                var r = 1.0 / (s1 * t2 - t1 * s2);
                sdir[0] = (t2 * x1 - t1 * x2) * r;
                sdir[1] = (t2 * y1 - t1 * y2) * r; 
                sdir[2] = (t2 * z1 - t1 * z2) * r;

                tdir[0] = (s1 * x2 - s2 * x1) * r;
                tdir[1] = (s1 * y2 - s2 * y1) * r;
                tdir[2] = (s1 * z2 - s2 * z1) * r;

                vec3Add(tan1[i1], tan1[i1], sdir);
                vec3Add(tan1[i2], tan1[i2], sdir);
                vec3Add(tan1[i3], tan1[i3], sdir);
                vec3Add(tan2[i1], tan2[i1], tdir);
                vec3Add(tan2[i2], tan2[i2], tdir);
                vec3Add(tan2[i3], tan2[i3], tdir);
            }
            var tmp = vec3Create();
            var nCrossT = vec3Create();
            var n = vec3Create();
            for (var i = 0; i < nVertex; i++) {
                n[0] = normals[i * 3];
                n[1] = normals[i * 3 + 1];
                n[2] = normals[i * 3 + 2];
                var t = tan1[i];

                // Gram-Schmidt orthogonalize
                vec3.scale(tmp, n, vec3.dot(n, t));
                vec3.sub(tmp, t, tmp);
                vec3.normalize(tmp, tmp);
                // Calculate handedness.
                vec3.cross(nCrossT, n, t);
                tangents[i * 4] = tmp[0];
                tangents[i * 4 + 1] = tmp[1];
                tangents[i * 4 + 2] = tmp[2];
                tangents[i * 4 + 3] = vec3.dot(nCrossT, tan2[i]) < 0.0 ? -1.0 : 1.0;
            }
        },

        isUniqueVertex: function() {
            if (this.isUseFace()) {
                return this.getVertexNumber() === this.faces.length;
            } else {
                return true;
            }
        },

        generateUniqueVertex: function() {
            var vertexUseCount = [];

            for (var i = 0, len = this.getVertexNumber(); i < len; i++) {
                vertexUseCount[i] = 0;
            }

            var cursor = this.getVertexNumber();
            var attributes = this.attributes;
            var faces = this.faces;

            var attributeNameList = this.getEnabledAttributes();

            for (var a = 0; a < attributeNameList.length; a++) {
                var name = attributeNameList[a];
                var expandedArray = new Float32Array(this.faces.length * attributes[name].size);
                var valueArr = attributes[name].value;
                var len = valueArr.length;
                for (var i = 0; i < len; i++) {
                    expandedArray[i] = valueArr[i];
                }
                attributes[name].value = expandedArray;
            }

            for (var i = 0; i < faces.length; i++) {
                var ii = faces[i];
                if (vertexUseCount[ii] > 0) {
                    for (var a = 0; a < attributeNameList.length; a++) {
                        var name = attributeNameList[a];
                        var array = attributes[name].value;
                        var size = attributes[name].size;

                        for (var k = 0; k < size; k++) {
                            array[cursor * size + k] = array[ii * size + k];
                        }
                    }
                    faces[i] = cursor;
                    cursor++;
                }
                vertexUseCount[ii]++;
            }
        },

        generateBarycentric: function() {

            if (! this.isUniqueVertex()) {
                this.generateUniqueVertex();
            }

            var attributes = this.attributes;
            var array = attributes.barycentric.value;
            var faces = this.faces;
            // Already existed;
            if (array && array.length === faces.length * 3) {
                return;
            }
            array = attributes.barycentric.value = new Float32Array(faces.length * 3);
            for (var i = 0; i < faces.length;) {
                for (var j = 0; j < 3; j++) {
                    var ii = faces[i++];
                    array[ii + j] = 1;
                }
            }
        },

        convertToDynamic: function(geometry) {
            for (var i = 0; i < this.faces.length; i+=3) {
                geometry.faces.push(this.face.subarray(i, i + 3));
            }

            var attributes = this.getEnabledAttributes();
            for (var name in attributes) {
                var attrib = attributes[name];
                var geoAttrib = geometry.attributes[name];
                if (!geoAttrib) {
                    geoAttrib = geometry.attributes[name] = {
                        type: attrib.type,
                        size: attrib.size,
                        value: []
                    };
                    if (attrib.semantic) {
                        geoAttrib.semantic = attrib.semantic;
                    }
                }
                for (var i = 0; i < attrib.value.length; i+= attrib.size) {
                    if (attrib.size === 1) {
                        geoAttrib.value.push(attrib.array[i]);
                    } else {
                        geoAttrib.value.push(attrib.subarray(i, i + attrib.size));
                    }
                }
            }

            if (this.boundingBox) {
                geometry.boundingBox = new BoundingBox();
                geometry.boundingBox.min.copy(this.boundingBox.min);
                geometry.boundingBox.max.copy(this.boundingBox.max);
            }
            // PENDING copy buffer ?
            
            return geometry;
        },

        applyTransform: function(matrix) {

            var attributes = this.attributes;
            var positions = attributes.position.value;
            var normals = attributes.normal.value;
            var tangents = attributes.tangent.value;

            matrix = matrix._array;
            // Normal Matrix
            var inverseTransposeMatrix = mat4.create();
            mat4.invert(inverseTransposeMatrix, matrix);
            mat4.transpose(inverseTransposeMatrix, inverseTransposeMatrix);

            var vec3TransformMat4 = vec3.transformMat4;
            var vec3ForEach = vec3.forEach;
            vec3ForEach(positions, 3, 0, null, vec3TransformMat4, matrix);
            if (normals) {
                vec3ForEach(normals, 3, 0, null, vec3TransformMat4, inverseTransposeMatrix);
            }
            if (tangents) {
                vec3ForEach(tangents, 4, 0, null, vec3TransformMat4, inverseTransposeMatrix);   
            }

            if (this.boundingBox) {
                this.updateBoundingBox();
            }
        },

        dispose: function(_gl) {
            var cache = this._cache;
            cache.use(_gl.__GLID__);
            var chunks = cache.get('chunks');
            if (chunks) {
                for (var c = 0; c < chunks.length; c++) {
                    var chunk = chunks[c];

                    for (var k = 0; k < chunk.attributeBuffers.length; k++) {
                        var attribs = chunk.attributeBuffers[k];
                        _gl.deleteBuffer(attribs.buffer);
                    }
                }
            }
            cache.deleteContext(_gl.__GLID__);
        }
    });

    return StaticGeometry;
});