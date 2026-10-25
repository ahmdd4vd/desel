import{Component,type ErrorInfo,type ReactNode}from'react';
/** Never clear database/storage on recovery. Keep implementation diagnostics out
 * of the user surface; a render failure is not permission to discard work. */
export class StudioErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return{failed:true}}
 componentDidCatch(_error:Error,_info:ErrorInfo){/* Deliberately no user content or keys in logs. */}
 render(){if(!this.state.failed)return this.props.children;return <main className="studio-recovery" role="alert"><section><p className="recovery-eyebrow">DESEL</p><h1>Workspace berhenti ditampilkan.</h1><p>Data lokal tidak dihapus. Muat ulang untuk membuka proyek tersimpan dan memeriksa pemulihan draft bila tersedia.</p><p>Edit yang belum tersimpan atau belum selesai di canvas mungkin belum masuk ke draft. Jangan hapus data aplikasi atau pasang ulang sebelum memeriksa proyek.</p><button className="btn btn-primary" onClick={()=>window.location.reload()}>Muat ulang workspace</button><p className="recovery-note">Jika masalah berulang, tutup dan buka Desel lagi. Pemulihan ini bukan jaminan bahwa semua edit terakhir sudah tersimpan.</p></section></main>}
}
