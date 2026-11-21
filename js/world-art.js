// Latitude registration for the approved illustrated world map.
// The illustration is not survey-grade; pins keep their actual coordinates.
const anchors = [[90,0],[60,.1466],[30,.3382],[0,.6313],[-30,.7666],[-60,.9019],[-90,1]];
let promise;
export function loadWorldArt() {
  return promise ||= new Promise((resolve,reject) => {
    const image = new Image();
    image.onerror = () => { promise = null; reject(new Error('Could not load watercolor map')); };
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high';
      for(let y=0; y<canvas.height; y++) {
        const lat=90-y/canvas.height*180;
        const i=Math.min(anchors.length-2, anchors.findIndex((a,j)=>j<anchors.length-1 && lat<=a[0] && lat>=anchors[j+1][0]));
        const [a,b]=[anchors[Math.max(0,i)],anchors[Math.max(0,i)+1]];
        const v=a[1]+(a[0]-lat)/(a[0]-b[0])*(b[1]-a[1]);
        ctx.drawImage(image,0,Math.min(image.naturalHeight-1,v*image.naturalHeight),image.naturalWidth,1,0,y,canvas.width,1);
      }
      resolve(canvas);
    };
    image.src='assets/watercolor-world.png';
  });
}
