/**
 *      __         ___            __        __
 *     / /_  ___  / (_)___ ______/ /___  __/ /
 *    / __ \/ _ \/ / / __ `/ ___/ __/ / / / / 
 *   / / / /  __/ / / /_/ / /__/ /_/ /_/ / /  
 *  /_/ /_/\___/_/_/\__,_/\___/\__/\__, /_/   
 *                               /____/      
 * 
 *     Heliactyl 19.1.1 (Excavator)
 * 
 */

const loadConfig = require("../handlers/config.js");
const settings = loadConfig("./config.toml");
const jwt = require('jsonwebtoken');

/* Ensure platform release target is met */
const heliactylModule = { "name": "Heliactyl Autologin 1.0.2", "api_level": 3, "target_platform": "19.1.1" };

if (heliactylModule.target_platform !== settings.version) {
  console.log('Module ' + heliactylModule.name + ' does not support this platform release of Heliactyl. The module was built for platform ' + heliactylModule.target_platform + ' but is attempting to run on version ' + settings.version + '.')
  process.exit()
}

let secretKey = settings.website.secret;

/* Module */
module.exports.heliactylModule = heliactylModule;
module.exports.load = async function (app, db) {
  app.get("/panel/doAutologin", async (req,res) => {
    if(!req.session.userinfo) return res.sendStatus(403);
    let jwtData = {
        email: req.session.userinfo.email,
        isValidLogin: true
    };
    let token = jwt.sign(jwtData,secretKey,{expiresIn:'1h'});
    res.redirect(`${settings.pterodactyl.domain}/auth/autologin/callback/${token}`)
  });
};

// <?php
// 
// namespace Pterodactyl\Http\Controllers\Auth;
// 
// use Pterodactyl\Http\Controllers\Controller;
// use Illuminate\Http\Request;
// use Firebase\JWT\JWT;
// use Firebase\JWT\Key;
// use Illuminate\Support\Facades\Auth;
// use Pterodactyl\Models\User;
// 
// class AutoLoginController extends Controller
// {
//     private $secretKey = "FractalSecretKey__NIGGER__Login";
// 
//     public function callback(Request $request, $token)
//     {
//         try {
//             $decoded = JWT\JWT::decode($token, new Key($this->secretKey, 'HS256'));
//             
//             if ($decoded->isValidLogin) {
//                 $user = User::where('email', $decoded->email)->first();
//                 
//                 if ($user) {
//                     Auth::login($user);
//                     return redirect('/');
//                 }
//             }
//             
//             return redirect('/auth/login')->with('error', 'Login automatique échoué');
//         } catch (\Exception $e) {
//             return redirect('/auth/login')->with('error', 'Token invalide');
//         }
//     }
// }

// Route::get('/auth/autologin/callback/{token}', [AutoLoginController::class, 'callback'])->name('auth.autologin.callback');

// composer require firebase/php-jwt